import os
import shutil
from typing import List, Optional

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from auth import get_current_user
from config import settings

router = APIRouter(prefix="/files", tags=["files"])


def safe_path(rel: str) -> str:
    base = os.path.realpath(settings.SERVICES_BASE_DIR)
    full = os.path.realpath(os.path.join(base, rel.lstrip("/")))
    if not full.startswith(base):
        raise HTTPException(status_code=403, detail="Access denied")
    return full


class FileNode(BaseModel):
    name: str
    path: str
    is_dir: bool
    size: Optional[int] = None


class SaveRequest(BaseModel):
    path: str
    content: str


@router.get("/list", response_model=List[FileNode])
async def list_files(path: str = "/", _user=Depends(get_current_user)):
    full = safe_path(path)
    if not os.path.exists(full):
        raise HTTPException(status_code=404, detail="Path not found")
    if not os.path.isdir(full):
        raise HTTPException(status_code=400, detail="Not a directory")

    nodes = []
    base = os.path.realpath(settings.SERVICES_BASE_DIR)
    for entry in sorted(os.scandir(full), key=lambda e: (not e.is_dir(), e.name.lower())):
        rel = "/" + os.path.relpath(entry.path, base).replace("\\", "/")
        nodes.append(
            FileNode(
                name=entry.name,
                path=rel,
                is_dir=entry.is_dir(),
                size=entry.stat().st_size if entry.is_file() else None,
            )
        )
    return nodes


@router.get("/read")
async def read_file(path: str, _user=Depends(get_current_user)):
    full = safe_path(path)
    if not os.path.isfile(full):
        raise HTTPException(status_code=404, detail="File not found")
    async with aiofiles.open(full, "r", errors="replace") as f:
        content = await f.read()
    return {"path": path, "content": content}


@router.post("/save")
async def save_file(req: SaveRequest, _user=Depends(get_current_user)):
    full = safe_path(req.path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    async with aiofiles.open(full, "w") as f:
        await f.write(req.content)
    return {"success": True}


@router.post("/mkdir")
async def make_dir(path: str, _user=Depends(get_current_user)):
    full = safe_path(path)
    os.makedirs(full, exist_ok=True)
    return {"success": True}


@router.delete("/delete")
async def delete_path(path: str, _user=Depends(get_current_user)):
    full = safe_path(path)
    if not os.path.exists(full):
        raise HTTPException(status_code=404, detail="Not found")
    if os.path.isfile(full):
        os.remove(full)
    else:
        shutil.rmtree(full)
    return {"success": True}


@router.post("/upload")
async def upload_file(
    path: str, file: UploadFile = File(...), _user=Depends(get_current_user)
):
    full = safe_path(path)
    os.makedirs(full, exist_ok=True)
    dest = os.path.join(full, file.filename)
    async with aiofiles.open(dest, "wb") as f:
        await f.write(await file.read())
    rel = "/" + os.path.relpath(dest, settings.SERVICES_BASE_DIR).replace("\\", "/")
    return {"success": True, "path": rel}
