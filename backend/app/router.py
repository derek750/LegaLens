from fastapi import APIRouter

from app.auth.router import router as auth_router
from app.agents.router import router as agents_router
from app.db.router import router as db_router
from app.services.router import router as services_router

router = APIRouter(prefix="/api")

router.include_router(auth_router)
router.include_router(agents_router)
router.include_router(db_router)
router.include_router(services_router)
