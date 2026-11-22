"""Text cleaning, whole-number checks and a small stable hash (FNV-1a) shared with the JS port."""

from __future__ import annotations

import re

_BIDI = "".join(f"{chr(a)}-{chr(b)}" for a, b in ((0x200B, 0x200F), (0x202A, 0x202E), (0x2066, 0x2069)))
_CONTROL = re.compile(f"[\x00-\x1f\x7f{_BIDI}]")
_SPACE = re.compile(r"[ \t\n\r\f\v\u00a0\u2028\u2029\u3000]+")


class InputError(ValueError):
    """Bad input; ``code`` maps to an ``err.<code>`` text."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def clean(text: object, limit: int) -> str:
    """Drop control and bidi characters, squeeze spaces, cut to ``limit`` characters (code points)."""
    s = _CONTROL.sub(" ", "" if text is None else str(text))
    return " ".join(p for p in _SPACE.split(s) if p)[:limit]


def whole(value: object, lo: int, hi: int, code: str) -> int:
    """An int (not a bool, not a float) or a short string of ASCII digits, within [lo, hi]."""
    if isinstance(value, str) and 0 < len(value.strip()) <= 9 and value.strip().isascii() and value.strip().isdigit():
        n = int(value.strip())
    elif isinstance(value, int) and not isinstance(value, bool):
        n = value
    else:
        raise InputError(code)
    if not lo <= n <= hi:
        raise InputError(code)
    return n


def h32(text: str) -> int:
    """32-bit FNV-1a (the JS port uses Math.imul and gives the same numbers)."""
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h
