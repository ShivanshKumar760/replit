from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    port: int = 5000
    jwt_secret: str = "change-me-in-production"
    pg_user: str = "postgres"
    pg_host: str = "localhost"
    pg_database: str = "postgres"
    pg_password: str = "postgres"
    pg_port: int = 5432
    workspace_dir: str = "workspaces"


settings = Settings()
