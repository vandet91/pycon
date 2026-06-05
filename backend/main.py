import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm

from auth import create_access_token, verify_password
from config import settings
from routers import files, logs, projects, services, terminal

app = FastAPI(title="PyServer Manager", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/auth/login")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    if form_data.username != settings.ADMIN_USERNAME:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not settings.ADMIN_PASSWORD_HASH or not verify_password(
        form_data.password, settings.ADMIN_PASSWORD_HASH
    ):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token({"sub": form_data.username})
    return {"access_token": token, "token_type": "bearer"}


@app.get("/api/health")
async def health():
    return {"status": "ok"}


app.include_router(services.router, prefix="/api")
app.include_router(files.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(terminal.router, prefix="/api")
app.include_router(logs.router, prefix="/api")
