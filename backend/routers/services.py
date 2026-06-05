import asyncio
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user

router = APIRouter(tags=["services"])


class ServiceInfo(BaseModel):
    name: str
    load: str
    active: str
    sub: str
    description: str


async def run(cmd: list[str]) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")


@router.get("/services", response_model=List[ServiceInfo])
async def list_services(
    search: Optional[str] = None, _user=Depends(get_current_user)
):
    rc, out, _ = await run(
        ["systemctl", "list-units", "--type=service", "--all", "--no-pager", "--plain"]
    )
    services = []
    lines = out.strip().splitlines()
    # Skip the header line and the trailing legend lines
    for line in lines[1:]:
        if not line.strip() or line.startswith("LOAD") or line.startswith("Legend:"):
            continue
        parts = line.split(None, 4)
        if len(parts) < 4:
            continue
        name = parts[0].removesuffix(".service")
        if search and search.lower() not in name.lower():
            continue
        services.append(
            ServiceInfo(
                name=name,
                load=parts[1],
                active=parts[2],
                sub=parts[3],
                description=parts[4].strip() if len(parts) > 4 else "",
            )
        )
    return services


@router.get("/services/{name}/status")
async def service_status(name: str, _user=Depends(get_current_user)):
    rc, out, err = await run(
        ["systemctl", "status", f"{name}.service", "--no-pager", "-l"]
    )
    return {"name": name, "output": out or err, "returncode": rc}


@router.post("/services/{name}/{action}")
async def service_action(name: str, action: str, _user=Depends(get_current_user)):
    allowed = {"start", "stop", "restart", "reload", "enable", "disable"}
    if action not in allowed:
        raise HTTPException(status_code=400, detail=f"Action must be one of: {allowed}")
    rc, out, err = await run(["sudo", "systemctl", action, f"{name}.service"])
    if rc != 0:
        raise HTTPException(status_code=500, detail=err.strip() or out.strip())
    return {"success": True, "output": out}


@router.post("/services/{name}/pip-install")
async def pip_install(name: str, req_path: str, _user=Depends(get_current_user)):
    """Run pip install -r <req_path> for a service."""
    import os
    if not os.path.isfile(req_path):
        raise HTTPException(status_code=404, detail="requirements.txt not found at given path")
    rc, out, err = await run(["pip", "install", "-r", req_path])
    return {"returncode": rc, "output": out, "error": err}
