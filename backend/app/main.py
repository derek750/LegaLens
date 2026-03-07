import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.router import router

# Use INFO by default so DEBUG logs (e.g. httpx, httpcore, PDF content) don't flood the console
logging.basicConfig(level=logging.INFO)
for name in ("httpx", "httpcore", "python_multipart"):
    logging.getLogger(name).setLevel(logging.WARNING)

app = FastAPI(title="LegaLens API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

@app.get("/")
def root():
    return {"message": "LegaLens API"}


@app.get("/health")
def health():
    return {"status": "ok", "service": "LegaLens API"}

