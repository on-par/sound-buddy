import Foundation
import Testing
@testable import SoundBuddyKit

struct GuardDenialCase: Sendable, CustomStringConvertible {
    let name: String
    let message: OSCMessage
    let expectedError: OSCError
    var description: String { name }
}

let guardDenialCases: [GuardDenialCase] = {
    var cases = ReadOnlyOSCGuard.denyAddressPrefixes.map { prefix in
        GuardDenialCase(name: "deny-\(prefix)", message: OSCMessage(prefix), expectedError: .refusedWriteAddress(prefix))
    }
    cases.append(.init(
        name: "deny-slash-bounded-subpath",
        message: OSCMessage("/scene/1"),
        expectedError: .refusedWriteAddress("/scene/1")
    ))
    cases.append(.init(
        name: "non-allowlisted-with-args-eq",
        message: OSCMessage("/ch/01/eq/1/g", [.float(0.5)]),
        expectedError: .notAllowlistedWithArguments("/ch/01/eq/1/g")
    ))
    cases.append(.init(
        name: "non-allowlisted-with-args-mix",
        message: OSCMessage("/ch/01/mix", [.float(0.5)]),
        expectedError: .notAllowlistedWithArguments("/ch/01/mix")
    ))
    cases.append(.init(
        name: "node-denied-no-leading-slash",
        message: OSCMessage("/node", [.string("-libs/x")]),
        expectedError: .refusedNodeArgument("-libs/x")
    ))
    cases.append(.init(
        name: "node-denied-leading-slash",
        message: OSCMessage("/node", [.string("/-libs/uahfx")]),
        expectedError: .refusedNodeArgument("/-libs/uahfx")
    ))
    cases.append(.init(
        name: "node-denied-double-leading-slash",
        message: OSCMessage("/node", [.string("//save")]),
        expectedError: .refusedNodeArgument("//save")
    ))
    return cases
}()

@Suite struct ReadOnlyOSCGuardTests {
    @Test(arguments: guardDenialCases)
    func encoderRefusesDeniedAndWithArgsWrites(_ testCase: GuardDenialCase) {
        do {
            _ = try OSCCodec.encode(testCase.message)
            Issue.record("expected \(testCase.expectedError) for \(testCase.name)")
        } catch let error {
            #expect(error == testCase.expectedError, "\(testCase.name)")
        }
    }

    @Test func allowsReadPathMessages() throws {
        #expect(try !OSCCodec.encode(OSCMessage("/scenegroup")).isEmpty)
        #expect(try !OSCCodec.encode(OSCMessage("/xremote")).isEmpty)

        for address in ReadOnlyOSCGuard.allowedWithArgumentsAddresses {
            let bytes = try OSCCodec.encode(OSCMessage(address, [.int(1)]))
            #expect(!bytes.isEmpty, "\(address)")
        }

        #expect(try !OSCCodec.encode(OSCMessage("/node", [.string("ch/01/mix")])).isEmpty)
        #expect(try !OSCCodec.encode(OSCMessage("/node", [.int(42)])).isEmpty)
    }

    /// Parity guard: the Swift deny/allow lists must match
    /// DENY_ADDRESS_PREFIXES / ALLOWED_WITH_ARGS_ADDRESSES in
    /// read-only-guard.ts exactly, or the two guards diverge silently.
    @Test func denyAndAllowListsMatchTypeScript() throws {
        let guardTs = try String(
            contentsOf: TestPaths.repoRoot.appending(path: "packages/console/src/read-only-guard.ts"),
            encoding: .utf8
        )

        func quotedStrings(after marker: String, in source: String) -> [String] {
            guard let startRange = source.range(of: marker) else { return [] }
            let rest = source[startRange.upperBound...]
            guard let endRange = rest.range(of: "]") else { return [] }
            let block = rest[rest.startIndex..<endRange.lowerBound]
            return block.matches(of: /'([^']+)'/).map { String($0.1) }
        }

        let deny = quotedStrings(after: "DENY_ADDRESS_PREFIXES = [", in: guardTs)
        let allow = quotedStrings(after: "ALLOWED_WITH_ARGS_ADDRESSES: string[] = [", in: guardTs)

        #expect(deny == ReadOnlyOSCGuard.denyAddressPrefixes)
        #expect(Set(allow) == ReadOnlyOSCGuard.allowedWithArgumentsAddresses)
        #expect(allow.count == ReadOnlyOSCGuard.allowedWithArgumentsAddresses.count)
    }
}
