import asyncio
import fcntl
import json
import os
import pty
import select
import struct
import termios

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from auth import verify_token

router = APIRouter(tags=["terminal"])


@router.websocket("/ws/terminal")
async def terminal_ws(websocket: WebSocket, token: str = Query(...)):
    try:
        verify_token(token)
    except Exception:
        await websocket.close(code=4001)
        return

    await websocket.accept()

    master_fd, slave_fd = pty.openpty()
    env = {**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor"}

    process = await asyncio.create_subprocess_exec(
        "/bin/bash",
        "--login",
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        env=env,
        close_fds=True,
    )
    os.close(slave_fd)

    loop = asyncio.get_event_loop()
    alive = True

    async def read_pty():
        nonlocal alive
        while alive:
            try:
                ready = await loop.run_in_executor(
                    None, lambda: select.select([master_fd], [], [], 0.2)[0]
                )
                if ready:
                    data = os.read(master_fd, 4096)
                    await websocket.send_bytes(data)
            except (OSError, IOError):
                break
        alive = False

    async def write_pty():
        nonlocal alive
        while alive:
            try:
                msg = await websocket.receive_text()
                try:
                    obj = json.loads(msg)
                    if obj.get("type") == "resize":
                        cols = int(obj.get("cols", 80))
                        rows = int(obj.get("rows", 24))
                        fcntl.ioctl(
                            master_fd,
                            termios.TIOCSWINSZ,
                            struct.pack("HHHH", rows, cols, 0, 0),
                        )
                        continue
                except (json.JSONDecodeError, TypeError, ValueError):
                    pass
                os.write(master_fd, msg.encode())
            except (WebSocketDisconnect, RuntimeError):
                break
        alive = False

    try:
        await asyncio.gather(read_pty(), write_pty())
    finally:
        alive = False
        try:
            process.terminate()
        except Exception:
            pass
        try:
            os.close(master_fd)
        except Exception:
            pass
