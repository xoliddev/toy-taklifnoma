"""Settings from environment variables (see .env.example). Nothing secret has a default."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Minimal .env reader so beginners do not need extra packages. Real env vars win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _ids(text: str) -> frozenset[int]:
    out = set()
    for part in text.replace(";", ",").split(","):
        part = part.strip()
        if part:
            if not part.isdigit():
                raise SystemExit(f"ADMIN_IDS must be numeric Telegram user ids, got {part!r}")
            out.add(int(part))
    return frozenset(out)


def _int(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.environ.get(name, str(default)).strip()
    if not raw.isdigit() or not lo <= int(raw) <= hi:
        raise SystemExit(f"{name} must be a whole number between {lo} and {hi}, got {raw!r}")
    return int(raw)


@dataclass(frozen=True)
class Settings:
    bot_token: str
    qr_secret: bytes
    public_url: str = ""
    db_path: str = "data/toytaklif.db"
    host: str = "0.0.0.0"  # noqa: S104 - the container must listen on all interfaces
    port: int = 8080
    admin_ids: frozenset[int] = field(default_factory=frozenset)
    seed_demo: bool = True
    initdata_max_age: int = 3600
    rate_per_minute: int = 30
    public_rate_per_minute: int = 40
    trust_proxy: bool = False

    @property
    def webapp_url(self) -> str:
        return f"{self.public_url}/webapp/" if self.public_url else ""

    @classmethod
    def from_env(cls, dotenv: Path | None = Path(".env")) -> Settings:
        if dotenv is not None:
            _load_dotenv(dotenv)
        env = os.environ.get
        token = env("BOT_TOKEN", "").strip()
        if not token or ":" not in token:
            raise SystemExit("BOT_TOKEN is missing. Copy .env.example to .env and paste the token from @BotFather.")
        secret = env("QR_SECRET", "").strip()
        if len(secret) < 32 or secret.startswith("replace-"):
            raise SystemExit("QR_SECRET must be a random string of at least 32 characters. Make one with:\n"
                             "  python -c \"import secrets; print(secrets.token_urlsafe(32))\"")
        url = env("PUBLIC_URL", "").strip().rstrip("/")
        if url and not url.startswith("https://"):
            raise SystemExit("PUBLIC_URL must start with https:// (Telegram opens Mini Apps only over HTTPS).")
        return cls(
            bot_token=token, qr_secret=secret.encode(), public_url=url,
            db_path=env("DB_PATH", cls.db_path), host=env("HOST", cls.host), port=_int("PORT", cls.port, 1, 65535),
            admin_ids=_ids(env("ADMIN_IDS", "")), seed_demo=env("SEED_DEMO", "1").strip() not in ("0", "false", "no"),
            initdata_max_age=_int("INITDATA_MAX_AGE", cls.initdata_max_age, 60, 86_400),
            rate_per_minute=_int("RATE_PER_MINUTE", cls.rate_per_minute, 1, 1000),
            public_rate_per_minute=_int("PUBLIC_RATE_PER_MINUTE", cls.public_rate_per_minute, 1, 1000),
            trust_proxy=env("TRUST_PROXY", "0").strip() in ("1", "true", "yes"),
        )
