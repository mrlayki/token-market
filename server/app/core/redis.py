from redis.asyncio import Redis

from app.core.config import settings

redis: Redis = Redis.from_url(
    settings.redis_url,
    decode_responses=True,
    socket_timeout=2.0,
    socket_connect_timeout=2.0,
    health_check_interval=30,
    max_connections=512,
)


# 阻塞类命令（XREADGROUP BLOCK）专用连接，读超时需大于阻塞时间
redis_blocking: Redis = Redis.from_url(
    settings.redis_url,
    decode_responses=True,
    socket_timeout=15.0,
    socket_connect_timeout=2.0,
    health_check_interval=30,
)
