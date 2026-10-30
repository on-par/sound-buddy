import Foundation
import Testing
@testable import SoundBuddyKit

private let homeWiFi = ConsoleWiFiNetwork(address: ConsoleIPv4("192.168.1.20")!, netmask: ConsoleIPv4("255.255.255.0")!)

@Suite struct ConsoleAddressTests {
    // MARK: - ConsoleIPv4 parsing

    @Test func parsesAValidDottedQuad() {
        let ip = ConsoleIPv4("192.168.1.50")
        #expect(ip?.octets == [192, 168, 1, 50])
        #expect(ip?.description == "192.168.1.50")
    }

    @Test func trimsSurroundingWhitespace() {
        #expect(ConsoleIPv4("  10.0.0.1  ") == ConsoleIPv4("10.0.0.1"))
    }

    @Test func rejectsLeadingZeros() {
        #expect(ConsoleIPv4("192.168.01.1") == nil)
        #expect(ConsoleIPv4("192.168.001.1") == nil)
    }

    @Test func acceptsALoneZeroField() {
        #expect(ConsoleIPv4("10.0.0.0") != nil)
    }

    @Test func rejectsOutOfRangeOctets() {
        #expect(ConsoleIPv4("256.1.1.1") == nil)
        #expect(ConsoleIPv4("1.1.1.999") == nil)
    }

    @Test func rejectsWrongFieldCount() {
        #expect(ConsoleIPv4("192.168.1") == nil)
        #expect(ConsoleIPv4("192.168.1.1.1") == nil)
    }

    @Test func rejectsEmptyFieldsFromAdjacentDots() {
        #expect(ConsoleIPv4("192..1.1") == nil)
        #expect(ConsoleIPv4("192.168.1.") == nil)
    }

    @Test func rejectsInternalSpaces() {
        #expect(ConsoleIPv4("192.168. 1.1") == nil)
    }

    @Test func rejectsLettersAndHex() {
        #expect(ConsoleIPv4("abc.def.ghi.jkl") == nil)
        #expect(ConsoleIPv4("0xA.0.0.1") == nil)
    }

    @Test func rejectsLeadingSignCharacters() {
        #expect(ConsoleIPv4("+192.168.1.1") == nil)
        #expect(ConsoleIPv4("192.168.1.-1") == nil)
    }

    // MARK: - isPrivate

    @Test func tenSlashEightIsPrivate() {
        #expect(ConsoleAddressValidator.isPrivate(ConsoleIPv4("10.0.0.0")!))
        #expect(ConsoleAddressValidator.isPrivate(ConsoleIPv4("10.255.255.255")!))
    }

    @Test func oneSeventyTwoRangeEdgesArePrivate() {
        #expect(ConsoleAddressValidator.isPrivate(ConsoleIPv4("172.16.0.1")!))
        #expect(ConsoleAddressValidator.isPrivate(ConsoleIPv4("172.31.255.254")!))
    }

    @Test func oneSeventyTwoJustOutsideTheRangeIsNotPrivate() {
        #expect(!ConsoleAddressValidator.isPrivate(ConsoleIPv4("172.15.255.255")!))
        #expect(!ConsoleAddressValidator.isPrivate(ConsoleIPv4("172.32.0.0")!))
    }

    @Test func oneNinetyTwoSlashSixteenIsPrivate() {
        #expect(ConsoleAddressValidator.isPrivate(ConsoleIPv4("192.168.0.1")!))
        #expect(ConsoleAddressValidator.isPrivate(ConsoleIPv4("192.168.255.254")!))
    }

    @Test func publicLoopbackAndLinkLocalAreNotPrivate() {
        #expect(!ConsoleAddressValidator.isPrivate(ConsoleIPv4("8.8.8.8")!))
        #expect(!ConsoleAddressValidator.isPrivate(ConsoleIPv4("127.0.0.1")!))
        #expect(!ConsoleAddressValidator.isPrivate(ConsoleIPv4("169.254.1.1")!))
    }

    // MARK: - validate

    @Test func validateRefusesEmptyText() {
        #expect(ConsoleAddressValidator.validate("", wifi: homeWiFi) == .failure(.empty))
        #expect(ConsoleAddressValidator.validate("   ", wifi: homeWiFi) == .failure(.empty))
    }

    @Test func validateRefusesMalformedText() {
        #expect(ConsoleAddressValidator.validate("not-an-ip", wifi: homeWiFi) == .failure(.malformed("not-an-ip")))
    }

    @Test func validateRefusesAPublicAddress() {
        #expect(ConsoleAddressValidator.validate("8.8.8.8", wifi: homeWiFi) == .failure(.notPrivate("8.8.8.8")))
    }

    @Test func validateRefusesWhenThereIsNoWiFi() {
        #expect(ConsoleAddressValidator.validate("192.168.1.50", wifi: nil) == .failure(.noWiFi))
    }

    @Test func validateRefusesAnOffSubnetAddress() {
        #expect(ConsoleAddressValidator.validate("192.168.2.5", wifi: homeWiFi) == .failure(.offSubnet("192.168.2.5", homeWiFi)))
    }

    @Test func validateRefusesThePhonesOwnAddress() {
        #expect(ConsoleAddressValidator.validate("192.168.1.20", wifi: homeWiFi) == .failure(.notConsole("192.168.1.20")))
    }

    @Test func validateRefusesTheNetworkAndBroadcastAddresses() {
        #expect(ConsoleAddressValidator.validate("192.168.1.0", wifi: homeWiFi) == .failure(.notConsole("192.168.1.0")))
        #expect(ConsoleAddressValidator.validate("192.168.1.255", wifi: homeWiFi) == .failure(.notConsole("192.168.1.255")))
    }

    @Test func validateSucceedsForAnOnSubnetPrivateAddress() throws {
        let result = ConsoleAddressValidator.validate("192.168.1.50", wifi: homeWiFi)
        #expect(try result.get() == ConsoleIPv4("192.168.1.50"))
    }

    // MARK: - Error messages

    @Test func everyErrorMessageNamesTheIPAndAnAction() {
        #expect(ConsoleAddressError.empty.message.contains("Enter"))
        #expect(ConsoleAddressError.malformed("x").message.contains("x"))
        #expect(ConsoleAddressError.malformed("x").message.contains("Enter"))
        #expect(ConsoleAddressError.notPrivate("8.8.8.8").message.contains("8.8.8.8"))
        #expect(ConsoleAddressError.notPrivate("8.8.8.8").message.contains("Check"))
        #expect(ConsoleAddressError.offSubnet("192.168.2.5", homeWiFi).message.contains("192.168.2.5"))
        #expect(ConsoleAddressError.offSubnet("192.168.2.5", homeWiFi).message.contains("Join"))
        #expect(ConsoleAddressError.noWiFi.message.contains("Join"))
        #expect(ConsoleAddressError.notConsole("192.168.1.0").message.contains("192.168.1.0"))
        #expect(ConsoleAddressError.notConsole("192.168.1.0").message.contains("Enter"))
    }

    // MARK: - ConsoleWiFiNetwork

    @Test func displayNameShowsTheNetworkAddressAndPrefixLength() {
        #expect(homeWiFi.displayName == "Wi-Fi 192.168.1.0/24")
    }

    @Test func prefixLengthIsThePopcountOfTheNetmask() {
        #expect(homeWiFi.prefixLength == 24)
        let slash16 = ConsoleWiFiNetwork(address: ConsoleIPv4("10.1.2.3")!, netmask: ConsoleIPv4("255.255.0.0")!)
        #expect(slash16.prefixLength == 16)
    }

    @Test func containsMatchesOnlyAddressesOnTheSameSubnet() {
        #expect(homeWiFi.contains(ConsoleIPv4("192.168.1.99")!))
        #expect(!homeWiFi.contains(ConsoleIPv4("192.168.2.99")!))
    }
}
