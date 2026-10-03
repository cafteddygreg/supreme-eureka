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

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

@lru_cache
def get_settings():
    return Settings()

settings = get_settings()
