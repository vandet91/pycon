# PyServer Manager

A self-hosted web dashboard for managing Python services (Telegram bots, scripts, etc.) on a Linux server — without needing SSH.

Upload code, install dependencies, manage systemd services, browse files, run a live terminal, view logs, and manage databases — all from a browser.

---

## Features

- **Projects** — upload a `.zip` or `.py` file, auto-install `requirements.txt`, configure and deploy as a systemd service
- **Services** — list, start, stop, restart all systemd services; see running/stopped/failed status badges
- **File Browser** — browse, create, edit (Monaco editor), upload, delete files and folders
- **Terminal** — live WebSocket PTY bash shell in the browser (xterm.js)
- **Logs** — live `journalctl -f` log stream per service
- **Database Manager** — SQLite browser + MySQL/PostgreSQL server management
- **Single admin login** — JWT auth, 8-hour token

---

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI (Python 3.11+) |
| Frontend | Next.js 14.2.3 (App Router, TypeScript, Tailwind CSS) |
| Auth | JWT via `python-jose`, bcrypt password hashing |
| Terminal | WebSocket PTY (`pty` module) + xterm.js |
| Editor | Monaco Editor (`@monaco-editor/react`) |
| DB clients | pymysql (MySQL), psycopg2-binary (PostgreSQL) |

---

## Project Structure

```
pycon/
├── backend/
│   ├── main.py               # FastAPI app, CORS, auth endpoint
│   ├── auth.py               # JWT + bcrypt helpers
│   ├── config.py             # Settings from .env
│   ├── create_admin.py       # Helper to generate password hash
│   ├── .env.example
│   └── routers/
│       ├── services.py       # systemctl management
│       ├── files.py          # File browser API
│       ├── projects.py       # Upload, deploy, venv, pip install
│       ├── database.py       # SQLite manager
│       ├── dbserver.py       # MySQL/PostgreSQL manager
│       ├── terminal.py       # WebSocket PTY
│       └── logs.py           # WebSocket journalctl
└── frontend/
    ├── app/
    │   ├── login/            # Login page
    │   └── (app)/
    │       ├── dashboard/    # Overview
    │       ├── services/     # Service manager
    │       ├── projects/     # Deploy new projects
    │       ├── files/        # File browser + editor
    │       ├── terminal/     # Live terminal
    │       ├── logs/         # Live logs
    │       └── database/     # DB manager
    ├── lib/api.ts            # Typed API client
    ├── next.config.mjs
    └── .env.local.example
```

---

## Setup (Linux VPS)

### Prerequisites

```bash
sudo apt update
sudo apt install python3 python3-venv python3-pip nodejs npm ffmpeg
```

Allow the app user to manage services without a password:

```bash
sudo visudo
# Add this line (replace www-data with your user):
your_user ALL=(ALL) NOPASSWD: /bin/systemctl
```

### 1. Clone / copy to server

```bash
mkdir -p /opt/pycon
cd /opt/pycon
# Copy or git clone your project here
```

### 2. Backend setup

```bash
cd /opt/pycon/backend

python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

Create `.env`:

```bash
cp .env.example .env
nano .env
```

```env
SECRET_KEY=your-long-random-secret-key
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=                        # fill in after next step
SERVICES_BASE_DIR=/opt/pycon               # root for file browser & projects
ALLOWED_ORIGINS=http://your-server-ip:3000
VENV_PYTHON=/usr/bin/python3
```

Generate a password hash:

```bash
venv/bin/python3 -c "import bcrypt; print(bcrypt.hashpw(b'your-password', bcrypt.gensalt()).decode())"
```

Paste the output as `ADMIN_PASSWORD_HASH=` in `.env`.

Generate a secret key:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 3. Frontend setup

```bash
cd /opt/pycon/frontend

cp .env.local.example .env.local
nano .env.local
```

```env
NEXT_PUBLIC_API_URL=http://your-server-ip:8000
```

> **Important:** `NEXT_PUBLIC_API_URL` is baked in at build time — set it before running `npm run build`.

```bash
npm install
npm run build
```

---

## Running

### Development (quick start)

```bash
# Terminal 1 — backend
cd /opt/pycon/backend
venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — frontend
cd /opt/pycon/frontend
npm run dev
```

### Production (systemd services)

**Backend service** — `/etc/systemd/system/pycon-backend.service`:

```ini
[Unit]
Description=PyServer Manager Backend
After=network.target

[Service]
User=root
WorkingDirectory=/opt/pycon/backend
ExecStart=/opt/pycon/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**Frontend service** — `/etc/systemd/system/pycon-frontend.service`:

```ini
[Unit]
Description=PyServer Manager Frontend
After=network.target

[Service]
User=root
WorkingDirectory=/opt/pycon/frontend
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable pycon-backend pycon-frontend
sudo systemctl start pycon-backend pycon-frontend

# Check status
sudo systemctl status pycon-backend
sudo systemctl status pycon-frontend
```

Access the dashboard at: `http://your-server-ip:3000`

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login → JWT token |
| GET | `/api/health` | Health check |
| GET/POST/DELETE | `/api/services/*` | List/start/stop/restart services |
| GET/POST/DELETE | `/api/files/*` | Browse/read/save/upload/delete files |
| GET/POST/DELETE | `/api/projects/*` | List/upload/deploy/delete projects |
| WS | `/api/ws/deploy/{name}` | Live deploy output |
| WS | `/api/ws/install/{name}` | Live pip install output |
| GET/POST/DELETE | `/api/database/*` | SQLite management |
| GET/POST/DELETE | `/api/dbserver/*` | MySQL/PostgreSQL management |
| WS | `/api/ws/terminal` | Live bash PTY shell |
| WS | `/api/ws/logs/{service}` | Live journalctl stream |

---

## Projects — Deploy Flow

1. **Upload** — drag-and-drop `.zip` or `.py` file  
2. **Install** — auto-detects `requirements.txt`, creates venv, streams `pip install` live  
3. **Configure** — set entry point (`.py` file), display name, description, env vars  
4. **Deploy** — creates `/etc/systemd/system/<name>.service`, enables and starts it  

After deploy, use **Start / Stop / Restart** buttons on the Projects or Services page.

---

## Database Manager

### SQLite
- Auto-scans all `.db`, `.sqlite`, `.sqlite3` files under `SERVICES_BASE_DIR`
- Browse tables, paginated rows, create/edit/delete rows
- Visual table builder (column name + type picker)
- SQL query editor (Monaco)
- Export table as JSON

### MySQL / PostgreSQL
- Add server connections (host, port, user, password, database)
- Configs saved to `backend/data/servers.json`
- Manage databases, tables, users, grants
- Row-level insert/edit/delete
- Raw SQL query editor

---

## Known Issues & Fixes

| Issue | Fix |
|-------|-----|
| `passlib` incompatible with new `bcrypt` | Use `import bcrypt` directly — do NOT use passlib |
| `next.config.ts` not supported | Use `next.config.mjs` (Next.js 14.2.3 limitation) |
| xterm CSS import causes TS error | Move `@import "xterm/css/xterm.css"` to `globals.css` |
| Login returns "Invalid credentials" | `ALLOWED_ORIGINS` must match browser-facing URL (not `localhost` when accessing by server IP) |
| `NEXT_PUBLIC_API_URL` ignored | Must be set in `.env.local` **before** `npm run build` — it's baked in at compile time |
| venv not created on deploy | Requires `python3-venv`: `sudo apt install python3-venv` |
| systemctl permission denied | Add `NOPASSWD: /bin/systemctl` to sudoers |
