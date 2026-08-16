"""Minimal, dependency-free OSC client for Midas M32R / Behringer X32 consoles.

Stdlib only (socket, struct). No pip installs.

SAFETY
------
This module is deliberately hard to misuse. Every outbound message passes
through ``assert_read_only()``, which rejects anything that could mutate
console state. The rules are:

1. A message with **zero arguments** is a query. On the X32/M32 OSC
   implementation, sending a bare parameter path makes the console reply with
   the current value and changes nothing. These are always allowed, except for
   paths on the DENY_PREFIXES list.
2. A message **with arguments** is allowed only if its address is on
   ALLOWED_WITH_ARGS, a short list of commands that have been individually
   reviewed as read-only (subscription and node-query commands).
3. Anything matching DENY_PREFIXES is rejected outright regardless of
   arguments, because those subtrees contain actions and stores.

If you are adding a new message and it is not obviously covered above, do not
widen the lists. Ask a human.
"""

import socket
import struct

OSC_PORT = 10023

# --- Commands that take arguments but do not change console state -----------
# /node   <path>   -> console replies with a text dump of that node. Read.
# /info            -> identity. Read.
# /xinfo           -> identity incl. IP. Read.
# /status          -> identity/state. Read.
# /xremote         -> registers this client to receive change notifications for
#                     ~10 s. Affects only what the console SENDS to us.
# /unsubscribe     -> tears down our own subscriptions.
# /renew   <id>    -> refreshes our own subscription.
# /meters  <path>  -> subscribes us to a meter stream. Read.
ALLOWED_WITH_ARGS = frozenset(
    {
        "/node",
        "/info",
        "/xinfo",
        "/status",
        "/xremote",
        "/unsubscribe",
        "/renew",
        "/meters",
    }
)

# --- Subtrees that are never touched, with or without arguments -------------
# These contain scene/snapshot stores, library operations, undo, and the
# generic action endpoint. A bare query here is not worth the risk.
DENY_PREFIXES = (
    "/save",
    "/load",
    "/copy",
    "/paste",
    "/delete",
    "/add",
    "/undo",
    "/scene",
    "/snapshot",
    "/cue",
    "/-action",
    "/-libs",
    "/‑action",  # non-ASCII hyphen, defensive
)


class UnsafeMessage(RuntimeError):
    """Raised when a message would, or might, change console state."""


def assert_read_only(address, args):
    """Raise UnsafeMessage unless this message is provably read-only."""
    if not address.startswith("/"):
        raise UnsafeMessage("OSC address must start with '/': %r" % address)

    lowered = address.lower()
    for bad in DENY_PREFIXES:
        if lowered == bad or lowered.startswith(bad + "/"):
            raise UnsafeMessage("address %r is on the deny list (%r)" % (address, bad))

    if args:
        if address not in ALLOWED_WITH_ARGS:
            raise UnsafeMessage(
                "refusing to send %r with arguments %r; only %s may carry arguments"
                % (address, args, sorted(ALLOWED_WITH_ARGS))
            )


# --- OSC 1.0 wire format ----------------------------------------------------


def _pad(raw):
    """Pad a bytes blob to the next 4-byte boundary (OSC alignment).

    Note the outer % 4: when the blob is already aligned it needs ZERO extra
    bytes, not four. Getting this wrong is subtle because it only affects
    strings whose length-with-terminator is a multiple of 4 (e.g. "/meters",
    ",si"). Lenient parsers skip the stray nulls, so most queries still work
    and only a few commands mysteriously fail.
    """
    return raw + b"\x00" * ((4 - (len(raw) % 4)) % 4)


def _encode_string(text):
    return _pad(text.encode("utf-8", "replace") + b"\x00")


def encode(address, *args):
    """Build an OSC message. Refuses to encode anything that could be a write."""
    assert_read_only(address, args)

    out = [_encode_string(address)]
    tags = ","
    body = []
    for arg in args:
        if isinstance(arg, str):
            tags += "s"
            body.append(_encode_string(arg))
        elif isinstance(arg, bool):
            raise UnsafeMessage("bool args are not used by this tool")
        elif isinstance(arg, int):
            tags += "i"
            body.append(struct.pack(">i", arg))
        elif isinstance(arg, float):
            tags += "f"
            body.append(struct.pack(">f", arg))
        else:
            raise TypeError("unsupported OSC argument type: %r" % type(arg))
    out.append(_encode_string(tags))
    out.extend(body)
    return b"".join(out)


def _read_string(data, offset):
    end = data.index(b"\x00", offset)
    text = data[offset:end].decode("utf-8", "replace")
    # advance past the terminator, then to the next 4-byte boundary
    offset = end + 1
    offset += (4 - (offset % 4)) % 4
    return text, offset


def decode(data):
    """Parse an OSC message into (address, typetags, [args]).

    Returns typetags without the leading comma. Blobs come back as bytes.
    Unknown type tags stop parsing and are reported in the tag string.
    """
    address, offset = _read_string(data, 0)
    args = []
    tags = ""
    if offset < len(data) and data[offset : offset + 1] == b",":
        raw_tags, offset = _read_string(data, offset)
        tags = raw_tags[1:]
        for tag in tags:
            if tag == "s":
                value, offset = _read_string(data, offset)
                args.append(value)
            elif tag == "i":
                (value,) = struct.unpack(">i", data[offset : offset + 4])
                offset += 4
                args.append(value)
            elif tag == "f":
                (value,) = struct.unpack(">f", data[offset : offset + 4])
                offset += 4
                args.append(value)
            elif tag == "b":
                (length,) = struct.unpack(">i", data[offset : offset + 4])
                offset += 4
                blob = data[offset : offset + length]
                offset += length + ((4 - (length % 4)) % 4)
                args.append(blob)
            else:
                args.append("<unparsed:%s>" % tag)
                break
    return address, tags, args


# --- Client -----------------------------------------------------------------


class Console:
    """A polite, read-only OSC client bound to one console."""

    def __init__(self, host, port=OSC_PORT, timeout=0.6):
        self.host = host
        self.port = port
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(timeout)
        self.sent = 0

    def send(self, address, *args):
        payload = encode(address, *args)  # guardrail runs here
        self.sock.sendto(payload, (self.host, self.port))
        self.sent += 1

    def recv(self):
        """Receive one message, or None on timeout."""
        try:
            data, _ = self.sock.recvfrom(65535)
        except socket.timeout:
            return None
        return decode(data)

    def query(self, address, *args, retries=2):
        """Send a read and wait for the matching reply.

        The console answers a query on the same address, so we drain any
        unrelated traffic (meter frames, /xremote pushes) until we see it.
        """
        for _ in range(retries):
            self.send(address, *args)
            for _ in range(40):
                message = self.recv()
                if message is None:
                    break
                if message[0] == address:
                    return message
        return None

    def close(self):
        self.sock.close()
