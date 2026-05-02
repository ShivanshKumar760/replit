from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import init_db, settings
from app.models import Project, User  # noqa: F401 - register models with Base
from app.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    # shutdown if needed


app = FastAPI(title="Mini Replit API", lifespan=lifespan)
app.include_router(router, tags=["replit"])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=True,
    )
