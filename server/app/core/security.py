"""密码哈希、JWT、API 令牌哈希、渠道 Key 加密。"""

import base64
import hashlib
import hmac
import os
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings

_ph = PasswordHasher()


def hash_password(raw: str) -> str:
    return _ph.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, raw)
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_access_token(user_id: int, role: str, auth_version: int) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "role": role,
        "av": auth_version,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


# ---------- API 令牌 ----------
API_KEY_PREFIX = "sk-"


def generate_api_key() -> str:
    return API_KEY_PREFIX + secrets.token_urlsafe(36).replace("-", "a").replace("_", "b")


def hash_api_key(key: str) -> str:
    # 令牌本身为高熵随机串，用 HMAC-SHA256 即可，避免 argon2 带来的鉴权延迟
    return hmac.new(settings.jwt_secret.encode(), key.encode(), hashlib.sha256).hexdigest()


def mask_api_key(key: str) -> str:
    return f"{key[:7]}...{key[-4:]}"


# ---------- 渠道 Key 加密（AES-256-GCM） ----------
def _aes() -> AESGCM:
    raw = base64.urlsafe_b64decode(settings.channel_key_secret)
    if len(raw) != 32:
        raise ValueError("TM_CHANNEL_KEY_SECRET 必须是 32 字节的 base64url 编码")
    return AESGCM(raw)


def encrypt_secret(plain: str) -> str:
    nonce = os.urandom(12)
    ct = _aes().encrypt(nonce, plain.encode(), b"channel-key")
    return "v1:" + base64.urlsafe_b64encode(nonce + ct).decode()


def decrypt_secret(token: str) -> str:
    if not token.startswith("v1:"):
        raise ValueError("unknown secret format")
    data = base64.urlsafe_b64decode(token[3:])
    return _aes().decrypt(data[:12], data[12:], b"channel-key").decode()


def mask_secret(plain: str) -> str:
    if len(plain) <= 10:
        return "*" * len(plain)
    return f"{plain[:6]}****{plain[-4:]}"


def sign_payload(fields: dict[str, str], secret: str) -> str:
    """支付回调签名：按 key 排序拼接后 HMAC-SHA256。"""
    msg = "&".join(f"{k}={fields[k]}" for k in sorted(fields) if k != "sign" and fields[k] != "")
    return hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
