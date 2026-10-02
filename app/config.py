from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
class Settings(BaseSettings):
    database_url:str='sqlite:///./igitorolive.db'; google_client_id:str=''; secret_key:str='change-me'; app_env:str='development'; upload_dir:str='app/static/uploads'; max_upload_mb:int=5; report_window_minutes:int=120
    model_config=SettingsConfigDict(env_file='.env',extra='ignore')
@lru_cache
def get_settings(): return Settings()
settings=get_settings()
