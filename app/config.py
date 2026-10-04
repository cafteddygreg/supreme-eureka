import os
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./igitoro.db")
    google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")
    google_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    secret_key: str = os.getenv("SECRET_KEY", "change-me")
    app_env: str = os.getenv("APP_ENV", "development")
    upload_dir: str = "app/static/uploads"
    max_upload_mb: int = 5
    report_window_minutes: int = 120

    # Configuration du Bot Telegram Intelligent & IA Multimodale (Gemini)
    telegram_bot_token: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    telegram_webhook_secret: str = os.getenv("TELEGRAM_WEBHOOK_SECRET", "")
    telegram_admin_chat_ids: str = os.getenv("TELEGRAM_ADMIN_CHAT_IDS", "")
    public_base_url: str = os.getenv("PUBLIC_BASE_URL", "https://igitorolive.up.railway.app")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def allowed_telegram_chat_ids(self) -> set[int]:
        """Retourne l'ensemble des chat_id Telegram autorisés à piloter le bot admin."""
        raw = (self.telegram_admin_chat_ids or "").strip()
        if not raw:
            return set()
        ids: set[int] = set()
        for part in raw.split(","):
            part = part.strip()
            if part.lstrip("-").isdigit():
                ids.add(int(part))
        return ids


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
