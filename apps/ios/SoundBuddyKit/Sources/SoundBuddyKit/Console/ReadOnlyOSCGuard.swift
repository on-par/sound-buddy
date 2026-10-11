import Foundation

/// Exact port of packages/console/src/read-only-guard.ts (ADR-0060). Baked
/// unconditionally into OSCCodec.encode — the only public encoder — so the
/// read path physically cannot emit a write (ADR-0161 item 2).
public enum ReadOnlyOSCGuard {
    public static let denyAddressPrefixes: [String] = [
        "/save", "/load", "/copy", "/paste", "/delete", "/add",
        "/undo", "/scene", "/snapshot", "/cue", "/-action", "/-libs",
    ]

    public static let allowedWithArgumentsAddresses: Set<String> = [
        "/node", "/meters", "/xremote", "/renew", "/unsubscribe", "/info", "/xinfo",
    ]

    static func isDenied(_ address: String) -> Bool {
        denyAddressPrefixes.contains { address == $0 || address.hasPrefix($0 + "/") }
    }

    public static func check(_ message: OSCMessage) throws(OSCError) {
        if isDenied(message.address) {
            throw .refusedWriteAddress(message.address)
        }

        if message.arguments.isEmpty {
            return
        }

        if !allowedWithArgumentsAddresses.contains(message.address) {
            throw .notAllowlistedWithArguments(message.address)
        }

        if message.address == "/node", case let .string(value) = message.arguments[0] {
            let normalized = "/" + value.drop { $0 == "/" }
            if isDenied(normalized) {
                throw .refusedNodeArgument(value)
            }
        }
    }
}
