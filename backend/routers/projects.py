import asyncio
import os
import shutil
import zipfile
import io

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional

from auth import get_current_user
from config import settings

router = APIRouter(prefix="/projects", tags=["projects"])

SYSTEMD_DIR = "/etc/systemd/system"
VENV_PYTHON = settings.VENV_PYTHON


async def run(cmd: list[str], cwd: str = None) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")


async def ensure_venv(project_dir: str) -> tuple[bool, str, str]:
    """Create venv if it doesn't exist. Returns (success, pip_path, log)."""
    venv_dir = os.path.join(project_dir, "venv")
    venv_pip = os.path.join(venv_dir, "bin", "pip")
    venv_python = os.path.join(venv_dir, "bin", "python3")

    if os.path.exists(venv_pip):
        return True, venv_pip, "[venv] Already exists\n"

    log = ""
    # Try creating with the configured python
    for python_bin in [VENV_PYTHON, "python3", "python"]:
        rc, out, err = await run([python_bin, "-m", "venv", venv_dir], cwd=project_dir)
        log += f"[venv] {python_bin} -m venv → rc={rc}\n"
        if rc == 0 and os.path.exists(venv_pip):
            log += "[venv] Created successfully\n"
            # Upgrade pip inside venv
            await run([venv_pip, "install", "--upgrade", "pip"], cwd=project_dir)
            return True, venv_pip, log
        log += f"  stderr: {err.strip()}\n"

    return False, "", log + "[venv] Failed to create venv. Try: sudo apt install python3-venv\n"


class ProjectCreate(BaseModel):
    name: str                        # service name e.g. "mybot"
    description: Optional[str] = ""
    python_file: str                 # entry point e.g. "bot.py"
    python_bin: Optional[str] = ""  # override python binary
    env_vars: Optional[str] = ""    # extra env lines e.g. BOT_TOKEN=xxx


@router.get("/list")
async def list_projects(_user=Depends(get_current_user)):
    base = os.path.realpath(settings.SERVICES_BASE_DIR)
    projects = []
    for name in sorted(os.listdir(base)):
        path = os.path.join(base, name)
        if not os.path.isdir(path):
            continue
        service_file = f"/etc/systemd/system/{name}.service"
        has_service = os.path.exists(service_file)
        has_req = os.path.exists(os.path.join(path, "requirements.txt"))
        projects.append({
            "name": name,
            "path": path,
            "has_service": has_service,
            "has_requirements": has_req,
        })
    return projects


@router.post("/upload")
async def upload_project(
    name: str,
    file: UploadFile = File(...),
    _user=Depends(get_current_user),
):
    """Upload a .zip file containing the project."""
    if not name.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid project name (use letters, numbers, - _)")

    base = os.path.realpath(settings.SERVICES_BASE_DIR)
    project_dir = os.path.join(base, name)
    os.makedirs(project_dir, exist_ok=True)

    content = await file.read()

    if file.filename.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            zf.extractall(project_dir)
    else:
        # Single file upload
        dest = os.path.join(project_dir, file.filename)
        with open(dest, "wb") as f:
            f.write(content)

    return {"success": True, "path": project_dir}


@router.post("/install-requirements")
async def install_requirements(name: str, _user=Depends(get_current_user)):
    base = os.path.realpath(settings.SERVICES_BASE_DIR)
    project_dir = os.path.join(base, name)
    req_file = os.path.join(project_dir, "requirements.txt")

    if not os.path.exists(req_file):
        raise HTTPException(status_code=404, detail="requirements.txt not found")

    ok, venv_pip, venv_log = await ensure_venv(project_dir)
    if not ok:
        raise HTTPException(status_code=500, detail=venv_log)

    rc, out, err = await run([venv_pip, "install", "-r", req_file], cwd=project_dir)
    return {"returncode": rc, "output": venv_log + out, "error": err}


@router.post("/create-service")
async def create_service(req: ProjectCreate, _user=Depends(get_current_user)):
    base = os.path.realpath(settings.SERVICES_BASE_DIR)
    project_dir = os.path.join(base, req.name)

    if not os.path.exists(project_dir):
        raise HTTPException(status_code=404, detail="Project directory not found — upload files first")

    # Determine python binary
    venv_python = os.path.join(project_dir, "venv", "bin", "python3")
    if req.python_bin:
        python_bin = req.python_bin
    elif os.path.exists(venv_python):
        python_bin = venv_python
    else:
        python_bin = VENV_PYTHON

    # Build env lines for service file
    env_lines = ""
    if req.env_vars:
        for line in req.env_vars.strip().splitlines():
            line = line.strip()
            if line and "=" in line and not line.startswith("#"):
                env_lines += f"Environment={line}\n"

    service_content = f"""[Unit]
Description={req.description or req.name}
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory={project_dir}
ExecStart={python_bin} {req.python_file}
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
{env_lines}
[Install]
WantedBy=multi-user.target
"""

    service_path = f"{SYSTEMD_DIR}/{req.name}.service"
    with open(service_path, "w") as f:
        f.write(service_content)

    # Reload systemd and enable
    await run(["systemctl", "daemon-reload"])
    await run(["systemctl", "enable", req.name])

    return {"success": True, "service_file": service_path, "content": service_content}


@router.post("/deploy")
async def deploy_project(req: ProjectCreate, _user=Depends(get_current_user)):
    """Install requirements + create service + start — all in one."""
    base = os.path.realpath(settings.SERVICES_BASE_DIR)
    project_dir = os.path.join(base, req.name)

    if not os.path.exists(project_dir):
        raise HTTPException(status_code=404, detail="Project directory not found")

    log = []

    # Install requirements if exists
    req_file = os.path.join(project_dir, "requirements.txt")
    venv_python = os.path.join(project_dir, "venv", "bin", "python3")

    if os.path.exists(req_file):
        ok, venv_pip, venv_log = await ensure_venv(project_dir)
        log.append(venv_log)
        if not ok:
            return {"success": False, "log": "\n".join(log)}
        rc, out, err = await run([venv_pip, "install", "-r", req_file], cwd=project_dir)
        log.append(f"[pip install] rc={rc}\n{out or err}")
    else:
        log.append("[pip] No requirements.txt found, skipping")

    # Create service
    python_bin = req.python_bin or (venv_python if os.path.exists(venv_python) else VENV_PYTHON)

    env_lines = ""
    if req.env_vars:
        for line in req.env_vars.strip().splitlines():
            line = line.strip()
            if line and "=" in line and not line.startswith("#"):
                env_lines += f"Environment={line}\n"

    service_content = f"""[Unit]
Description={req.description or req.name}
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory={project_dir}
ExecStart={python_bin} {req.python_file}
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
{env_lines}
[Install]
WantedBy=multi-user.target
"""

    service_path = f"{SYSTEMD_DIR}/{req.name}.service"
    with open(service_path, "w") as f:
        f.write(service_content)
    log.append(f"[service] Created {service_path}")

    await run(["systemctl", "daemon-reload"])
    await run(["systemctl", "enable", req.name])
    rc, out, err = await run(["systemctl", "restart", req.name])
    log.append(f"[systemctl restart] rc={rc} {err or 'started'}")

    return {"success": rc == 0, "log": "\n".join(log)}


@router.delete("/{name}")
async def delete_project(name: str, delete_files: bool = False, _user=Depends(get_current_user)):
    # Stop and disable service
    await run(["systemctl", "stop", name])
    await run(["systemctl", "disable", name])

    service_path = f"{SYSTEMD_DIR}/{name}.service"
    if os.path.exists(service_path):
        os.remove(service_path)
    await run(["systemctl", "daemon-reload"])

    if delete_files:
        base = os.path.realpath(settings.SERVICES_BASE_DIR)
        project_dir = os.path.join(base, name)
        if os.path.exists(project_dir):
            shutil.rmtree(project_dir)

    return {"success": True}
