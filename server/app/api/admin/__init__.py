from fastapi import APIRouter

from app.api.admin import catalog, channels, ops, upstream, users

router = APIRouter(prefix="/api/admin", tags=["admin"])
router.include_router(channels.router)
router.include_router(catalog.router)
router.include_router(users.router)
router.include_router(ops.router)
router.include_router(upstream.router)
