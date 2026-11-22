"""A QR matrix as a PNG (for the bot's photo message), written with zlib only: no imaging library needed."""

from __future__ import annotations

import struct
import zlib

from .core.qr import matrix


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png(text: str, scale: int = 10, border: int = 4) -> bytes:
    m = matrix(text)
    n = (len(m) + 2 * border) * scale
    rows = []
    for r in range(-border, len(m) + border):
        line = bytes(0 if 0 <= r < len(m) and 0 <= c < len(m) and m[r][c] else 255
                     for c in range(-border, len(m) + border) for _ in range(scale))
        rows.extend([b"\x00" + line] * scale)
    head = struct.pack(">IIBBBBB", n, n, 8, 0, 0, 0, 0)  # 8-bit greyscale
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", head) + _chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + _chunk(b"IEND", b"")
