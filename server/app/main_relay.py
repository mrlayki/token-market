"""数据面进程：/v1/*。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.logging import configure_litellm, setup_logging
from app.relay.router import router
from app.relay.upstream import close_http_client


@asynccontextmanager
async def lifespan(_: FastAPI):
    setup_logging()
    configure_litellm()
    yield
    await close_http_client()


app = FastAPI(title="Token Market Relay", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(router)


@app.get("/healthz")
async def healthz():
    return {"ok": True}
