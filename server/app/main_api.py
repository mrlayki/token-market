"""控制面进程：/api/*（用户端、管理端、公开接口、支付回调）。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.console.router import router as console_router
from app.api.public.router import router as public_router
from app.core.config import settings
from app.core.errors import AppError, app_error_handler
from app.core.logging import configure_litellm, setup_logging
from app.relay.upstream import close_http_client


@asynccontextmanager
async def lifespan(_: FastAPI):
    setup_logging()
    configure_litellm()
    yield
    await close_http_client()


app = FastAPI(title="Token Market API", lifespan=lifespan, docs_url=None if settings.is_prod else "/api/docs",
              openapi_url=None if settings.is_prod else "/api/openapi.json", redoc_url=None)
app.add_exception_handler(AppError, app_error_handler)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(auth_router)
app.include_router(public_router)
app.include_router(console_router)
app.include_router(admin_router)


@app.get("/api/healthz")
async def healthz():
    return {"ok": True}
