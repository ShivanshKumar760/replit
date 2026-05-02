from jose import jwt
from datetime import datetime, timedelta
from app.config.settings import settings

ALGORITHM = "HS256"
EXPIRES_DAYS = 7


def generate_token(payload: dict) -> str:
    to_encode = payload.copy()
    expire = datetime.utcnow() + timedelta(days=EXPIRES_DAYS)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        return payload
    except Exception:
        raise ValueError("Invalid token")
