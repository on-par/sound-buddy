import Foundation

/// Why a channel read stopped before producing a result.
public enum ConsoleChannelReadError: Error, Equatable, Sendable {
    case unsupportedModel(String)
    case transport(ConsoleTransportError)
    case cancelled
}

/// One finished read: the inventory, the role guesses over its complete
/// strips, and the room-mic candidates the review screen will offer.
public struct ConsoleChannelReadResult: Equatable, Sendable {
    public let inventory: ConsoleChannelInventory
    public let guesses: [ChannelRoleGuess]
    public let roomMicCandidates: [ChannelRoleGuess]

    public init(inventory: ConsoleChannelInventory, guesses: [ChannelRoleGuess], roomMicCandidates: [ChannelRoleGuess]) {
        self.inventory = inventory
        self.guesses = guesses
        self.roomMicCandidates = roomMicCandidates
    }

    public var missing: [ConsoleStripID] { inventory.missing }
    public var missingSummary: String? { inventory.missingSummary }
    public var readCount: Int { inventory.strips.count }

    /// Complete strips in walk order → guesser input. `id` is the strip's
    /// `configPath` (opaque to the guesser).
    public static func roleInputs(from inventory: ConsoleChannelInventory) -> [ChannelRoleInput] {
        inventory.stripIDs.compactMap { inventory.strips[$0] }
            .map { ChannelRoleInput(id: $0.id.configPath, name: $0.name, color: $0.color) }
    }
}

/// Drives #1782's `ConsoleChannelInventory` over an already-connected socket
/// (#1781's `ConsoleStore`), then #1783's `ChannelRoleGuesser`: send the
/// inventory's bounded `/node` walk, fold replies in as they arrive, then one
/// ADR-0142 sweep of whatever is still missing. The issue's AC fixes every
/// iOS query at `ConsoleLinkTiming.probeAttempts` × `probeTimeout` (3 × 350
/// ms) — ADR-0142's escalated retry budget belongs to the Mac's scene-capture
/// walk, not this phone-side read, so the sweep here is never escalated.
/// Side-effect free apart from the injected transport: no socket of its own.
public struct ConsoleChannelReader: Sendable {
    private let transport: any ConsoleTransport
    private let guesser: ChannelRoleGuesser

    public init(transport: any ConsoleTransport, guesser: ChannelRoleGuesser = .bundled()) {
        self.transport = transport
        self.guesser = guesser
    }

    /// The walk, then (if anything is still missing) one sweep. A model
    /// outside #1781's table fails immediately, sending nothing.
    public func read(_ info: ConsoleXInfo, host: ConsoleIPv4) async -> Result<ConsoleChannelReadResult, ConsoleChannelReadError> {
        guard var inventory = ConsoleChannelInventory(model: info.model) else {
            return .failure(.unsupportedModel(info.model))
        }

        do {
            for query in inventory.walkMessages() {
                try await ask(query, into: &inventory, host: host)
            }
            if !inventory.missing.isEmpty {
                for query in inventory.sweepMessages() {
                    try await ask(query, into: &inventory, host: host)
                }
            }
            return .success(makeResult(inventory))
        } catch {
            return .failure(error)
        }
    }

    /// Re-sweeps only `previous`'s still-missing strips (and any malformed
    /// strip's per-field queries) — never re-sends the full walk.
    public func retryMissing(_ previous: ConsoleChannelReadResult, host: ConsoleIPv4) async -> Result<ConsoleChannelReadResult, ConsoleChannelReadError> {
        var inventory = previous.inventory
        do {
            for query in inventory.sweepMessages() {
                try await ask(query, into: &inventory, host: host)
            }
            return .success(makeResult(inventory))
        } catch {
            return .failure(error)
        }
    }

    private func makeResult(_ inventory: ConsoleChannelInventory) -> ConsoleChannelReadResult {
        let guesses = guesser.guess(ConsoleChannelReadResult.roleInputs(from: inventory))
        return ConsoleChannelReadResult(
            inventory: inventory,
            guesses: guesses,
            roomMicCandidates: ChannelRoleGuesser.roomMicCandidates(in: guesses)
        )
    }

    /// One query, up to `ConsoleLinkTiming.probeAttempts` tries. Exhausting
    /// every attempt is a deferred miss (ADR-0142): returns normally and
    /// leaves the strip missing for the sweep/retry to pick up later.
    private func ask(
        _ query: OSCMessage, into inventory: inout ConsoleChannelInventory, host: ConsoleIPv4
    ) async throws(ConsoleChannelReadError) {
        let datagram: Data
        do {
            // OSCCodec.encode is the only public encoder and always runs the
            // read-only guard (ADR-0161 item 2); the inventory's own
            // walk/sweep queries can never fail it, but the throw is handled
            // anyway rather than force-tried (the ConsoleLink.probeXInfo idiom).
            datagram = try OSCCodec.encode(query)
        } catch {
            throw .transport(.failed(error.description))
        }

        for _ in 0..<ConsoleLinkTiming.probeAttempts {
            if Task.isCancelled { throw .cancelled }

            let reply: Data?
            do {
                reply = try await transport.exchange(
                    datagram, with: host, port: ConsoleLinkTiming.port, timeout: ConsoleLinkTiming.probeTimeout
                )
            } catch {
                throw .transport(error)
            }

            if Task.isCancelled { throw .cancelled }

            guard let reply, let message = try? OSCCodec.decode(reply) else { continue }

            if query.address == "/node", query.arguments.count == 1, case let .string(path) = query.arguments[0] {
                let expected = "/" + path
                if let line = message.nodeReplyLine(expectedPath: expected) {
                    inventory.apply(nodeLine: line)
                    return
                }
            } else if message.replyAddressMatches(query.address) {
                inventory.apply(fieldReply: message)
                return
            }
        }
    }
}
