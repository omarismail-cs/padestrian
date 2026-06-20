import os
from typing import Literal

from dotenv import load_dotenv

from padestrian.paths import PROJECT_ROOT

ListingsBackend = Literal["file", "supabase"]


def load_env(*, fresh: bool = False) -> None:
    """Load variables from .env. Use fresh=True to re-read after editing the file."""
    load_dotenv(PROJECT_ROOT / ".env", override=fresh)


def require_env(name: str, *, fresh: bool = False) -> str:
    load_env(fresh=fresh)
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set. Add it to .env (see .env.example).")
    return value


def listings_backend(*, fresh: bool = False) -> ListingsBackend:
    """Return catalog storage backend (file JSON or Supabase)."""
    load_env(fresh=fresh)
    explicit = os.getenv("LISTINGS_BACKEND", "").strip().lower()
    if explicit == "file":
        return "file"
    if explicit == "supabase":
        return "supabase"
    if os.getenv("SUPABASE_URL", "").strip() and os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip():
        return "supabase"
    return "file"
