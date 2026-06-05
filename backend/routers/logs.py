import asyncio

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from auth import verify_token

router = APIRouter(tags=["logs"])


@router.websocket("/ws/logs")
async def logs_ws(
    websocket: WebSocket,
    token: str = Query(...),
    service: str = Query(...),
    lines: int = Query(200),
):
    try:
        verify_token(token)
    except Exception:
        await websocket.close(code=4001)
        return

    await websocket.accept()

    process = await asyncio.create_subprocess_exec(
        "journalctl",
        "-u", f"{service}.service",
        "-n", str(lines),
        "-f",
        "--no-pager",
        "--output=short-precise",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    try:
        while True:
            line = await asyncio.wait_for(process.stdout.readline(), timeout=60)
            if not line:
                break
            await websocket.send_text(line.decode(errors="replace"))
    except (WebSocketDisconnect, asyncio.TimeoutError, RuntimeError):
        pass
    finally:
        try:
            process.terminate()
        except Exception:
            pass
