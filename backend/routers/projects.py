import asyncio
import json
import os
import shutil
import sys
import zipfile
import io

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect, Query
from pydantic import BaseModel
from typing import Optional

from auth import get_current_user, verify_token
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
    candidates = list(dict.fromkeys([sys.executable, VENV_PYTHON, "/usr/bin/python3", "python3"]))
    for python_bin in candidates:
        rc, out, err = await run([python_bin, "-m", "venv", venv_dir], cwd=project_dir)
        log += f"[venv] {python_bin} -m venv → rc={rc}\n"
        if rc == 0 and os.path.exists(venv_pip):
            log += "[venv] Created successfully\n"
            await run([venv_pip, "install", "--upgrade", "pip", "-q"], cwd=project_dir)
            return True, venv_pip, log
        log += f"  stderr: {err.strip()}\n"
        if os.path.exists(venv_dir):
            shutil.rmtree(venv_dir)

    return False, "", log + "[venv] Failed. Fix: sudo apt install python3-venv -y\n"


class ProjectCreate(BaseModel):
    name: str                        # service name e.g. "mybot"
    description: Optional[str] = ""
    python_file: str                 # entry point e.g. "bot.py"
    python_bin: Optional[str] = ""  # override python binary
    env_vars: Optional[str] = ""    # extra env lines e.g. BOT_TOKEN=xxx


async def get_service_status(name: str) -> dict:
    proc = await asyncio.create_subprocess_exec(
        "systemctl", "is-active", f"{name}.service",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    active = stdout.decode().strip()  # active, inactive, failed, activating

    proc2 = await asyncio.create_subprocess_exec(
        "systemctl", "is-enabled", f"{name}.service",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout2, _ = await proc2.communicate()
    enabled = stdout2.decode().strip()  # enabled, disabled, not-found

    return {"active": active, "enabled": enabled}


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

        # Check inside subdirectories too for requirements.txt
        actual_root = _find_project_root(path)
        has_req = os.path.exists(os.path.join(actual_root, "requirements.txt"))

        status = await get_service_status(name) if has_service else {"active": "none", "enabled": "none"}

        projects.append({
            "name": name,
            "path": actual_root,
            "has_service": has_service,
            "has_requirements": has_req,
            "active": status["active"],
            "enabled": status["enabled"],
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
        dest = os.path.join(project_dir, file.filename)
        with open(dest, "wb") as f:
            f.write(content)

    # Detect actual project root
    actual_root = _find_project_root(project_dir)

    # Check for requirements.txt
    req_file = os.path.join(actual_root, "requirements.txt")
    has_req = os.path.exists(req_file)

    # Detect entry point candidates
    py_files = [f for f in os.listdir(actual_root) if f.endswith(".py")]
    entry_candidates = []
    for preferred in ["main.py", "bot.py", "app.py", "run.py", "index.py"]:
        if preferred in py_files:
            entry_candidates.insert(0, preferred)
    for f in py_files:
        if f not in entry_candidates:
            entry_candidates.append(f)

    return {
        "success": True,
        "path": actual_root,
        "has_requirements": has_req,
        "entry_candidates": entry_candidates[:5],
    }


def _find_project_root(base: str) -> str:
    entries = os.listdir(base)
    has_py = any(f.endswith(".py") for f in entries)
    has_req = "requirements.txt" in entries
    if has_py or has_req:
        return base
    subdirs = [
        os.path.join(base, e) for e in entries
        if os.path.isdir(os.path.join(base, e)) and not e.startswith(".") and e != "venv"
    ]
    if len(subdirs) == 1:
        sub_entries = os.listdir(subdirs[0])
        if any(f.endswith(".py") for f in sub_entries) or "requirements.txt" in sub_entries:
            return subdirs[0]
    return base


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


@router.websocket("/ws/install")
async def ws_install(
    websocket: WebSocket,
    token: str = Query(...),
    name: str = Query(...),
):
    """Auto install requirements right after upload."""
    try:
        verify_token(token)
    except Exception:
        await websocket.close(code=4001)
        return

    await websocket.accept()

    async def send(msg: str, kind: str = "log"):
        await websocket.send_text(json.dumps({"type": kind, "msg": msg}))

    async def stream_cmd(cmd: list[str], cwd: str = None):
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,
        )
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            await send(line.decode(errors="replace").rstrip())
        await proc.wait()
        return proc.returncode

    try:
        base = os.path.realpath(settings.SERVICES_BASE_DIR)
        project_dir = os.path.join(base, name)
        actual_root = _find_project_root(project_dir)

        if actual_root != project_dir:
            await send(f"📂 Project root detected: {actual_root}")

        req_file = os.path.join(actual_root, "requirements.txt")
        if not os.path.exists(req_file):
            await send("⚠️  No requirements.txt found — skipping install", "warn")
            await send("done", "done")
            return

        # Show requirements.txt content
        with open(req_file) as f:
            reqs = f.read().strip()
        await send(f"📋 requirements.txt:\n{reqs}")

        # Create venv
        venv_dir = os.path.join(actual_root, "venv")
        venv_pip = os.path.join(venv_dir, "bin", "pip")

        if os.path.exists(venv_pip):
            await send("✓ Venv already exists")
        else:
            await send("🔧 Creating virtual environment...", "step")
            candidates = list(dict.fromkeys([sys.executable, VENV_PYTHON, "/usr/bin/python3", "python3"]))
            created = False
            for py in candidates:
                await send(f"   Trying {py}...")
                rc = await stream_cmd([py, "-m", "venv", venv_dir])
                if rc == 0 and os.path.exists(venv_pip):
                    await send(f"   ✓ Venv created", "success")
                    created = True
                    break
                if os.path.exists(venv_dir):
                    shutil.rmtree(venv_dir)
                await send(f"   ✗ Failed (rc={rc})")

            if not created:
                await send("❌ Cannot create venv. Run on server:", "error")
                await send("   sudo apt install python3-venv -y", "error")
                await send("done", "done")
                return

        # Upgrade pip
        await stream_cmd([venv_pip, "install", "--upgrade", "pip", "-q"])

        # Install requirements
        await send("📥 Installing requirements...", "step")
        rc = await stream_cmd([venv_pip, "install", "-r", req_file])
        if rc == 0:
            await send("✅ All requirements installed!", "success")
        else:
            await send("❌ Some packages failed to install", "error")

        await send("done", "done")

    except Exception as e:
        await send(f"❌ Error: {e}", "error")
        await send("done", "done")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/ws/deploy")
async def ws_deploy(
    websocket: WebSocket,
    token: str = Query(...),
    name: str = Query(...),
    python_file: str = Query("main.py"),
    description: str = Query(""),
    env_vars: str = Query(""),
):
    try:
        verify_token(token)
    except Exception:
        await websocket.close(code=4001)
        return

    await websocket.accept()

    async def send(msg: str, kind: str = "log"):
        await websocket.send_text(json.dumps({"type": kind, "msg": msg}))

    async def stream_cmd(cmd: list[str], cwd: str = None):
        """Run command and stream output line by line."""
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,
        )
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            await send(line.decode(errors="replace").rstrip())
        await proc.wait()
        return proc.returncode

    base = os.path.realpath(settings.SERVICES_BASE_DIR)
    project_dir = os.path.join(base, name)

    try:
        # ── Step 1: Check project directory ──────────────────────
        await send(f"📁 Project directory: {project_dir}", "step")
        if not os.path.exists(project_dir):
            await send(f"❌ Project directory not found", "error")
            return

        # List files found
        files_found = os.listdir(project_dir)
        await send(f"   Files found: {', '.join(files_found)}")

        # Auto-detect actual project root (handles zip with subfolder)
        # If no requirements.txt or python files at top level, check one level down
        def find_project_root(base: str) -> str:
            # Check if requirements.txt or .py files exist at base
            entries = os.listdir(base)
            has_py = any(f.endswith(".py") for f in entries)
            has_req = "requirements.txt" in entries
            if has_py or has_req:
                return base
            # Check subdirectories
            subdirs = [os.path.join(base, e) for e in entries if os.path.isdir(os.path.join(base, e)) and not e.startswith(".") and e != "venv"]
            if len(subdirs) == 1:
                subentries = os.listdir(subdirs[0])
                has_py2 = any(f.endswith(".py") for f in subentries)
                has_req2 = "requirements.txt" in subentries
                if has_py2 or has_req2:
                    return subdirs[0]
            return base

        actual_root = find_project_root(project_dir)
        if actual_root != project_dir:
            await send(f"   📂 Detected project root: {actual_root}")
        project_dir = actual_root

        # ── Step 2: Check requirements.txt ───────────────────────
        req_file = os.path.join(project_dir, "requirements.txt")
        if os.path.exists(req_file):
            await send("📦 Found requirements.txt", "step")

            # Create venv
            venv_dir = os.path.join(project_dir, "venv")
            venv_pip = os.path.join(venv_dir, "bin", "pip")
            venv_python = os.path.join(venv_dir, "bin", "python3")

            if os.path.exists(venv_pip):
                await send("   ✓ Venv already exists")
            else:
                await send("🔧 Creating virtual environment...", "step")

                # Try python candidates — sys.executable first (guaranteed to exist)
                candidates = list(dict.fromkeys([
                    sys.executable,
                    VENV_PYTHON,
                    "/usr/bin/python3",
                    "python3",
                ]))

                created = False
                for py in candidates:
                    await send(f"   Trying: {py} -m venv {venv_dir}")
                    rc = await stream_cmd([py, "-m", "venv", venv_dir])
                    if rc == 0 and os.path.exists(venv_pip):
                        await send(f"   ✓ Venv created with {py}")
                        created = True
                        break
                    else:
                        # Clean up failed venv dir before retrying
                        if os.path.exists(venv_dir):
                            shutil.rmtree(venv_dir)
                        await send(f"   ✗ Failed (rc={rc}), trying next...")

                if not created:
                    await send("❌ Could not create venv!", "error")
                    await send("   Fix: sudo apt install python3-venv -y", "error")
                    await send("   Then re-deploy the project.", "error")
                    await send("done", "done")
                    return

            # Upgrade pip silently
            await stream_cmd([venv_pip, "install", "--upgrade", "pip", "-q"])

            # Install requirements with full output
            await send("📥 Installing requirements...", "step")
            rc = await stream_cmd([venv_pip, "install", "-r", req_file])
            if rc == 0:
                await send("✅ Requirements installed successfully", "success")
            else:
                await send(f"❌ pip install failed (rc={rc})", "error")
                await send("   Fix the errors above then re-deploy.", "error")
                await send("done", "done")
                return
        else:
            await send("⚠️  No requirements.txt found, skipping install", "warn")
            venv_python = VENV_PYTHON

        # ── Step 3: Create systemd service ───────────────────────
        await send("⚙️  Creating systemd service...", "step")

        venv_python_path = os.path.join(project_dir, "venv", "bin", "python3")
        python_bin = venv_python_path if os.path.exists(venv_python_path) else VENV_PYTHON
        entry_point = os.path.join(project_dir, python_file)
        await send(f"   Python: {python_bin}")
        await send(f"   Entry: {entry_point}")

        env_lines = ""
        if env_vars:
            for line in env_vars.strip().splitlines():
                line = line.strip()
                if line and "=" in line and not line.startswith("#"):
                    env_lines += f"Environment={line}\n"

        service_content = f"""[Unit]
Description={description or name}
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory={project_dir}
ExecStart={python_bin} {entry_point}
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
{env_lines}
[Install]
WantedBy=multi-user.target
"""
        service_path = f"{SYSTEMD_DIR}/{name}.service"
        with open(service_path, "w") as f:
            f.write(service_content)
        await send(f"   ✓ Service file: {service_path}")

        # ── Step 4: Enable and start ──────────────────────────────
        await send("🚀 Starting service...", "step")
        await stream_cmd(["systemctl", "daemon-reload"])
        await stream_cmd(["systemctl", "enable", name])
        rc = await stream_cmd(["systemctl", "restart", name])

        if rc == 0:
            await send(f"✅ Service '{name}' is running!", "success")
        else:
            await send(f"❌ Service failed to start. Check logs: journalctl -u {name} -n 50", "error")

        await send("done", "done")

    except Exception as e:
        await send(f"❌ Unexpected error: {e}", "error")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


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
