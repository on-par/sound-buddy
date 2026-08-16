#!/usr/bin/env python3
"""Find M32R / X32 consoles on the LAN the way M32-Edit does.

Sends a read-only /info query to the broadcast address on UDP 10023 and listens
for replies. Falls back to a one-pass unicast sweep of the local /24 if
broadcast is filtered (common on church WiFi with client isolation).

Usage:
    python3 discover.py                # auto: broadcast, then sweep
    python3 discover.py --no-sweep     # broadcast only
    python3 discover.py 10.1.2.50      # probe one known IP
"""

import argparse
import socket
import sys
import time

import m32r_osc

BROADCAST_ATTEMPTS = 3
BROADCAST_LISTEN_S = 2.0
SWEEP_LISTEN_S = 3.0
SWEEP_PACKET_GAP_S = 0.002  # ~500 pps: one gentle pass, not a flood


def local_ipv4_interfaces():
    """Return [(ip, broadcast)] for up, non-loopback IPv4 interfaces."""
    found = []
    try:
        import subprocess

        out = subprocess.run(
            ["ifconfig"], capture_output=True, text=True, timeout=10
        ).stdout
    except Exception:
        return found
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("inet ") or "127.0.0.1" in line:
            continue
        parts = line.split()
        ip = parts[1]
        bcast = None
        if "broadcast" in parts:
            bcast = parts[parts.index("broadcast") + 1]
        if bcast:
            found.append((ip, bcast))
    return found


def _open_socket():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", 0))
    sock.settimeout(0.25)
    return sock


def _drain(sock, seconds, results):
    """Collect replies for `seconds`, recording any console that answers."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            data, addr = sock.recvfrom(65535)
        except socket.timeout:
            continue
        except OSError:
            continue
        try:
            address, tags, args = m32r_osc.decode(data)
        except Exception:
            continue
        if address in ("/info", "/xinfo", "/status"):
            entry = results.setdefault(addr[0], {})
            entry[address] = args
            entry["port"] = addr[1]
    return results


def probe(targets, listen_s, results, label):
    """Send a read-only /info to each target, then listen."""
    sock = _open_socket()
    packet = m32r_osc.encode("/info")
    sent = 0
    try:
        for attempt in range(BROADCAST_ATTEMPTS if len(targets) < 8 else 1):
            for target in targets:
                try:
                    sock.sendto(packet, (target, m32r_osc.OSC_PORT))
                    sent += 1
                except OSError:
                    pass
                if len(targets) > 8:
                    time.sleep(SWEEP_PACKET_GAP_S)
            if len(targets) < 8:
                _drain(sock, 0.5, results)
        _drain(sock, listen_s, results)
    finally:
        sock.close()
    print("  %s: sent %d /info probe(s), %d console(s) so far"
          % (label, sent, len(results)))
    return results


def describe(ip, entry):
    info = entry.get("/info") or entry.get("/xinfo") or []
    lines = ["  %s:%s" % (ip, entry.get("port", m32r_osc.OSC_PORT))]
    labels = ["server version", "console name", "console model", "firmware"]
    for label, value in zip(labels, info):
        lines.append("      %-15s %s" % (label + ":", value))
    extra = info[len(labels):]
    if extra:
        lines.append("      %-15s %s" % ("extra:", extra))
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host", nargs="?", help="probe this IP directly")
    parser.add_argument("--no-sweep", action="store_true",
                        help="skip the unicast fallback sweep")
    args = parser.parse_args()

    results = {}

    if args.host:
        print("Probing %s directly ..." % args.host)
        probe([args.host], BROADCAST_LISTEN_S, results, "direct")
    else:
        interfaces = local_ipv4_interfaces()
        if not interfaces:
            print("No usable IPv4 interface found. Pass an IP explicitly.")
            return 2
        print("Local interfaces: %s"
              % ", ".join("%s (bcast %s)" % (i, b) for i, b in interfaces))

        targets = ["255.255.255.255"] + [b for _, b in interfaces]
        print("Stage 1 - broadcast /info on UDP %d" % m32r_osc.OSC_PORT)
        probe(targets, BROADCAST_LISTEN_S, results, "broadcast")

        if not results and not args.no_sweep:
            for ip, bcast in interfaces:
                base = ip.rsplit(".", 1)[0]
                sweep = ["%s.%d" % (base, n) for n in range(1, 255)
                         if "%s.%d" % (base, n) != ip]
                print("Stage 2 - unicast sweep of %s.0/24 (%d hosts)"
                      % (base, len(sweep)))
                probe(sweep, SWEEP_LISTEN_S, results, "sweep %s.0/24" % base)

    print()
    if not results:
        print("No console answered on UDP %d." % m32r_osc.OSC_PORT)
        print("Either the console is off, on another VLAN/subnet, or the")
        print("network blocks client-to-client traffic. Supply an IP with:")
        print("    python3 discover.py <console-ip>")
        return 1

    print("Found %d console(s):" % len(results))
    for ip in sorted(results):
        print(describe(ip, results[ip]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
