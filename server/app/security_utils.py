"""SSRF 防护：渠道 base_url 校验。生产环境禁止指向内网 / 回环 / 链路本地地址（可通过白名单放行）。"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import socket
from urllib.parse import urlparse

from app.core.config import settings
from app.core.errors import AppError

# 允许的内网主机（如 docker 内的 mock-upstream、自建推理服务），逗号分隔
ALLOW_HOSTS = {h.strip() for h in os.getenv("TM_UPSTREAM_HOST_ALLOWLIST", "mock-upstream,localhost,127.0.0.1").split(",") if h.strip()}


async def validate_upstream_url(url: str) -> None:
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise AppError("base_url 必须是 http(s) 地址")
    if p.hostname in ALLOW_HOSTS:
        return
    if settings.env != "prod":
        return
    if p.scheme != "https":
        raise AppError("生产环境仅允许 https 上游地址")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(p.hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise AppError(f"无法解析上游域名 {p.hostname}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise AppError(f"上游地址解析到内网地址 {ip}，已拒绝（如需放行请配置 TM_UPSTREAM_HOST_ALLOWLIST）")
