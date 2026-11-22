"""The entry pass: an HMAC-signed token for the QR code, and a short code a door checker can type by hand.

``TT1.<wedding>.<invite>.<people>.<version>.<sig>``: the signature is the first 128 bits of HMAC-SHA256 with the
server's QR_SECRET, so a pass cannot be guessed or edited (changing "3 kishi" to "5 kishi" breaks it). Changing
an RSVP bumps the version, which turns the old pass into a forged one. The short code (10 characters, 50 bits of
the same HMAC over the invite and version) is for a phone that has no working camera.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re

PREFIX = "TT1"
CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford base32: no I, L, O, U
_N = r"([1-9][0-9]{0,8})"
_TOKEN = re.compile(rf"^TT1\.{_N}\.{_N}\.([1-9][0-9]?)\.([1-9][0-9]{{0,5}})\.([A-Za-z0-9_-]{{22}})$")
_FOLD = str.maketrans({"O": "0", "I": "1", "L": "1"})


def _mac(secret: bytes, message: str) -> bytes:
    return hmac.new(secret, message.encode(), hashlib.sha256).digest()


def sign(secret: bytes, wedding_id: int, invite_id: int, people: int, version: int) -> str:
    body = f"{wedding_id}.{invite_id}.{people}.{version}"
    sig = base64.urlsafe_b64encode(_mac(secret, f"qr|{body}")[:16]).decode().rstrip("=")
    return f"{PREFIX}.{body}.{sig}"


def parse(token: object) -> dict | None:
    """The fields of a well-formed token (signature not checked yet), or None."""
    if not isinstance(token, str) or len(token) > 80:
        return None
    m = _TOKEN.match(token.strip())
    if not m:
        return None
    w, i, p, v, sig = m.groups()
    return {"wedding_id": int(w), "invite_id": int(i), "people": int(p), "version": int(v), "sig": sig}


def verify(secret: bytes, token: object) -> dict | None:
    """The fields of a genuine token, or None for anything malformed or forged (constant-time comparison)."""
    f = parse(token)
    if f is None:
        return None
    good = sign(secret, f["wedding_id"], f["invite_id"], f["people"], f["version"])
    return f if hmac.compare_digest(good, str(token).strip()) else None


def entry_code(secret: bytes, invite_id: int, version: int) -> str:
    """``K7Q2M-9XD4A``: 50 bits of the HMAC in Crockford base32."""
    n = int.from_bytes(_mac(secret, f"code|{invite_id}|{version}")[:7], "big") >> 6
    chars = "".join(CODE_ALPHABET[(n >> (5 * (9 - k))) & 31] for k in range(10))
    return f"{chars[:5]}-{chars[5:]}"


def norm_code(text: object) -> str | None:
    """What a person typed -> ``XXXXX-XXXXX`` (O is read as 0, I and L as 1), or None."""
    if not isinstance(text, str) or len(text) > 40:
        return None
    s = "".join(ch for ch in text.upper() if ch.isascii() and ch.isalnum()).translate(_FOLD)
    if len(s) != 10 or any(ch not in CODE_ALPHABET for ch in s):
        return None
    return f"{s[:5]}-{s[5:]}"
