"""A small QR Code encoder (ISO/IEC 18004): byte mode, error correction level M, versions 1-10, best of 8 masks.

Written out here (and line by line in shared/qr.js) so the server and the browser draw the very same QR for a pass,
with no third-party code. ``matrix(text)`` returns rows of 0/1, without the quiet zone.
"""

from __future__ import annotations

# version -> (EC codewords per block, [(blocks, data codewords per block), ...]) for level M
BLOCKS = {1: (10, [(1, 16)]), 2: (16, [(1, 28)]), 3: (26, [(1, 44)]), 4: (18, [(2, 32)]), 5: (24, [(2, 43)]),
          6: (16, [(4, 27)]), 7: (18, [(4, 31)]), 8: (22, [(2, 38), (2, 39)]), 9: (22, [(3, 36), (2, 37)]),
          10: (26, [(4, 43), (1, 44)])}
ALIGN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42],
         9: [6, 26, 46], 10: [6, 28, 50]}
EC_M = 0  # format bits of level M


class QrError(ValueError):
    pass


def _gf_tables() -> tuple[list[int], list[int]]:
    exp, log = [0] * 512, [0] * 256
    x = 1
    for i in range(255):
        exp[i] = x
        log[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D
    for i in range(255, 512):
        exp[i] = exp[i - 255]
    return exp, log


EXP, LOG = _gf_tables()


def _mul(a: int, b: int) -> int:
    return 0 if a == 0 or b == 0 else EXP[LOG[a] + LOG[b]]


def rs_remainder(data: list[int], n: int) -> list[int]:
    """Reed-Solomon error correction codewords: ``data`` * x^n mod the generator polynomial of degree n."""
    gen = [1]
    for i in range(n):
        nxt = [0] * (len(gen) + 1)
        for j, g in enumerate(gen):
            nxt[j] ^= g
            nxt[j + 1] ^= _mul(g, EXP[i])
        gen = nxt
    rem = [0] * n
    for d in data:
        factor = d ^ rem[0]
        rem = [*rem[1:], 0]
        for j in range(n):
            rem[j] ^= _mul(gen[j + 1], factor)
    return rem


def capacity(version: int) -> int:
    return sum(b * d for b, d in BLOCKS[version][1])


def pick_version(n_bytes: int) -> int:
    for v in range(1, 11):
        if 4 + (8 if v < 10 else 16) + 8 * n_bytes <= 8 * capacity(v):
            return v
    raise QrError("too long")


def codewords(data: bytes, version: int) -> list[int]:
    bits: list[int] = []

    def put(value: int, n: int) -> None:
        bits.extend((value >> (n - 1 - k)) & 1 for k in range(n))

    put(0b0100, 4)
    put(len(data), 8 if version < 10 else 16)
    for b in data:
        put(b, 8)
    total = 8 * capacity(version)
    put(0, min(4, total - len(bits)))
    put(0, (8 - len(bits) % 8) % 8)
    out = [int("".join(map(str, bits[k:k + 8])), 2) for k in range(0, len(bits), 8)]
    pad = (0xEC, 0x11)
    while len(out) < capacity(version):
        out.append(pad[(len(out) - len(bits) // 8) % 2])
    ec_n, groups = BLOCKS[version]
    blocks, k = [], 0
    for count, size in groups:
        for _ in range(count):
            blocks.append(out[k:k + size])
            k += size
    ecs = [rs_remainder(b, ec_n) for b in blocks]
    final = [b[i] for i in range(max(len(b) for b in blocks)) for b in blocks if i < len(b)]
    return final + [e[i] for i in range(ec_n) for e in ecs]


def function_map(version: int) -> tuple[list[list[int]], list[list[bool]]]:
    """Finder, timing, alignment patterns, the dark module and reserved format/version areas."""
    n = 17 + 4 * version
    m = [[0] * n for _ in range(n)]
    fn = [[False] * n for _ in range(n)]

    def setf(r: int, c: int, v: int) -> None:
        m[r][c], fn[r][c] = v, True

    for r0, c0 in ((0, 0), (0, n - 7), (n - 7, 0)):
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                r, c = r0 + dr, c0 + dc
                if 0 <= r < n and 0 <= c < n:
                    inside = 0 <= dr <= 6 and 0 <= dc <= 6
                    ring = dr in (0, 6) or dc in (0, 6)
                    core = 2 <= dr <= 4 and 2 <= dc <= 4
                    setf(r, c, 1 if inside and (ring or core) else 0)
    pos = ALIGN[version]
    for r in pos:
        for c in pos:
            if fn[r][c]:  # the three corners under a finder pattern
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    setf(r + dr, c + dc, 1 if max(abs(dr), abs(dc)) != 1 else 0)
    for i in range(8, n - 8):
        setf(6, i, 1 - i % 2)
        setf(i, 6, 1 - i % 2)
    for i in range(9):
        if not fn[8][i]:
            setf(8, i, 0)
        if not fn[i][8]:
            setf(i, 8, 0)
    for i in range(8):
        setf(8, n - 1 - i, 0)
        setf(n - 1 - i, 8, 0)
    setf(n - 8, 8, 1)  # the dark module
    if version >= 7:
        for i in range(18):
            setf(n - 11 + i % 3, i // 3, 0)
            setf(i // 3, n - 11 + i % 3, 0)
    return m, fn


def _bch(value: int, poly: int, deg: int) -> int:
    rem = value << deg
    top = poly.bit_length() - 1
    while rem.bit_length() - 1 >= top:
        rem ^= poly << (rem.bit_length() - 1 - top)
    return (value << deg) | rem


def format_bits(mask: int) -> int:
    return _bch((EC_M << 3) | mask, 0x537, 10) ^ 0x5412


def version_bits(version: int) -> int:
    return _bch(version, 0x1F25, 12)


MASKS = (
    lambda r, c: (r + c) % 2 == 0,
    lambda r, c: r % 2 == 0,
    lambda r, c: c % 3 == 0,
    lambda r, c: (r + c) % 3 == 0,
    lambda r, c: (r // 2 + c // 3) % 2 == 0,
    lambda r, c: (r * c) % 2 + (r * c) % 3 == 0,
    lambda r, c: ((r * c) % 2 + (r * c) % 3) % 2 == 0,
    lambda r, c: ((r + c) % 2 + (r * c) % 3) % 2 == 0,
)


def zigzag(n: int) -> list[tuple[int, int]]:
    """Module positions in data order: two-column strips from the right, up and down, skipping column 6."""
    out, right = [], n - 1
    while right >= 1:
        if right == 6:
            right = 5
        upward = ((right + 1) & 2) == 0
        for vert in range(n):
            r = n - 1 - vert if upward else vert
            out.extend((r, right - j) for j in range(2))
        right -= 2
    return out


def draw_info(m: list[list[int]], version: int, mask: int) -> None:
    n = len(m)
    bits = format_bits(mask)
    b = [(bits >> i) & 1 for i in range(15)]
    for i in range(6):
        m[i][8] = b[i]
    m[7][8], m[8][8], m[8][7] = b[6], b[7], b[8]
    for i in range(9, 15):
        m[8][14 - i] = b[i]
    for i in range(8):
        m[8][n - 1 - i] = b[i]
    for i in range(8, 15):
        m[n - 15 + i][8] = b[i]
    m[n - 8][8] = 1
    if version >= 7:
        vb = version_bits(version)
        for i in range(18):
            bit = (vb >> i) & 1
            m[i // 3][n - 11 + i % 3] = bit
            m[n - 11 + i % 3][i // 3] = bit


def penalty(m: list[list[int]]) -> int:
    n, score = len(m), 0
    lines = [*m, *([m[r][c] for r in range(n)] for c in range(n))]
    finder_a, finder_b = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
    for line in lines:
        run = 1
        for k in range(1, n + 1):
            if k < n and line[k] == line[k - 1]:
                run += 1
            else:
                if run >= 5:
                    score += 3 + run - 5
                run = 1
        for k in range(n - 10):
            seg = line[k:k + 11]
            if seg in (finder_a, finder_b):
                score += 40
    for r in range(n - 1):
        for c in range(n - 1):
            if m[r][c] == m[r][c + 1] == m[r + 1][c] == m[r + 1][c + 1]:
                score += 3
    dark = sum(map(sum, m))
    return score + 10 * (abs(dark * 100 - n * n * 50) // (n * n * 5))


def matrix(text: str) -> list[list[int]]:
    data = text.encode("utf-8")
    version = pick_version(len(data))
    cw = codewords(data, version)
    base, fn = function_map(version)
    order = [(r, c) for r, c in zigzag(len(base)) if not fn[r][c]]
    bits = [(cw[i >> 3] >> (7 - (i & 7))) & 1 for i in range(8 * len(cw))]
    for k, (r, c) in enumerate(order):
        base[r][c] = bits[k] if k < len(bits) else 0
    best, best_score = None, -1
    for mask, rule in enumerate(MASKS):
        m = [row[:] for row in base]
        for r, c in order:
            if rule(r, c):
                m[r][c] ^= 1
        draw_info(m, version, mask)
        s = penalty(m)
        if best is None or s < best_score:
            best, best_score = m, s
    return best


def as_text(m: list[list[int]]) -> str:
    """Rows of 0/1 joined by '/', compact enough for the shared test vectors."""
    return "/".join("".join(map(str, row)) for row in m)
