"""
External Database Server Manager — MySQL & PostgreSQL
Handles: connections, databases, users, permissions, tables, queries
"""
import json
import os
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user

router = APIRouter(prefix="/dbserver", tags=["dbserver"])

# Store server configs in a JSON file
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
SERVERS_FILE = os.path.join(DATA_DIR, "servers.json")
os.makedirs(DATA_DIR, exist_ok=True)


# ── Server config storage ─────────────────────────────────────

def load_servers() -> dict:
    if not os.path.exists(SERVERS_FILE):
        return {}
    with open(SERVERS_FILE) as f:
        return json.load(f)


def save_servers(data: dict):
    with open(SERVERS_FILE, "w") as f:
        json.dump(data, f, indent=2)


# ── Models ────────────────────────────────────────────────────

class ServerConfig(BaseModel):
    name: str
    type: str          # mysql | postgres
    host: str
    port: Optional[int] = None
    user: str
    password: str
    save_password: bool = True


class QueryRequest(BaseModel):
    server_id: str
    database: Optional[str] = None
    sql: str


class CreateDatabaseRequest(BaseModel):
    server_id: str
    database: str
    charset: Optional[str] = "utf8mb4"    # MySQL
    encoding: Optional[str] = "UTF8"      # Postgres


class CreateUserRequest(BaseModel):
    server_id: str
    username: str
    password: str
    host: Optional[str] = "%"             # MySQL only


class GrantRequest(BaseModel):
    server_id: str
    username: str
    database: str
    privileges: str = "ALL PRIVILEGES"   # ALL, SELECT, INSERT, etc.
    host: Optional[str] = "%"            # MySQL only


class RevokeRequest(BaseModel):
    server_id: str
    username: str
    database: str
    privileges: str = "ALL PRIVILEGES"
    host: Optional[str] = "%"


# ── Connection helpers ────────────────────────────────────────

def get_server(server_id: str) -> dict:
    servers = load_servers()
    if server_id not in servers:
        raise HTTPException(status_code=404, detail="Server not found")
    return servers[server_id]


def connect_mysql(cfg: dict, database: str = None):
    import pymysql
    return pymysql.connect(
        host=cfg["host"],
        port=cfg.get("port") or 3306,
        user=cfg["user"],
        password=cfg["password"],
        database=database,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
    )


def connect_postgres(cfg: dict, database: str = None):
    import psycopg2
    import psycopg2.extras
    return psycopg2.connect(
        host=cfg["host"],
        port=cfg.get("port") or 5432,
        user=cfg["user"],
        password=cfg["password"],
        dbname=database or "postgres",
        connect_timeout=10,
    )


def connect(cfg: dict, database: str = None):
    if cfg["type"] == "mysql":
        return connect_mysql(cfg, database)
    elif cfg["type"] == "postgres":
        return connect_postgres(cfg, database)
    raise HTTPException(status_code=400, detail="Unsupported DB type")


def execute_query(cfg: dict, sql: str, database: str = None, params=None) -> dict:
    conn = connect(cfg, database)
    try:
        if cfg["type"] == "mysql":
            import pymysql
            with conn.cursor() as cur:
                cur.execute(sql, params or ())
                is_select = sql.strip().upper().split()[0] in ("SELECT", "SHOW", "DESCRIBE", "EXPLAIN", "WITH")
                if is_select:
                    rows = cur.fetchall()
                    cols = [d[0] for d in cur.description] if cur.description else []
                    return {"type": "select", "columns": cols, "rows": [list(r.values()) for r in rows], "rowcount": len(rows)}
                else:
                    conn.commit()
                    return {"type": "modify", "rowcount": cur.rowcount, "message": f"{cur.rowcount} row(s) affected"}
        else:
            import psycopg2.extras
            cur = conn.cursor()
            cur.execute(sql, params or ())
            is_select = sql.strip().upper().split()[0] in ("SELECT", "SHOW", "DESCRIBE", "EXPLAIN", "WITH")
            if is_select or cur.description:
                rows = cur.fetchall()
                cols = [d[0] for d in cur.description] if cur.description else []
                return {"type": "select", "columns": cols, "rows": [list(r) for r in rows], "rowcount": len(rows)}
            else:
                conn.commit()
                return {"type": "modify", "rowcount": cur.rowcount, "message": f"{cur.rowcount} row(s) affected"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


# ── Server CRUD ───────────────────────────────────────────────

@router.get("/servers")
async def list_servers(_user=Depends(get_current_user)):
    servers = load_servers()
    return [
        {**{k: v for k, v in s.items() if k != "password"}, "id": sid, "has_password": bool(s.get("password"))}
        for sid, s in servers.items()
    ]


@router.post("/servers")
async def add_server(cfg: ServerConfig, _user=Depends(get_current_user)):
    # Test connection first
    test_cfg = cfg.model_dump()
    try:
        conn = connect(test_cfg)
        conn.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {e}")

    servers = load_servers()
    sid = str(uuid.uuid4())[:8]
    servers[sid] = {
        "id": sid,
        "name": cfg.name,
        "type": cfg.type,
        "host": cfg.host,
        "port": cfg.port or (3306 if cfg.type == "mysql" else 5432),
        "user": cfg.user,
        "password": cfg.password if cfg.save_password else "",
    }
    save_servers(servers)
    return {"id": sid, "success": True}


@router.delete("/servers/{server_id}")
async def delete_server(server_id: str, _user=Depends(get_current_user)):
    servers = load_servers()
    if server_id not in servers:
        raise HTTPException(status_code=404, detail="Not found")
    del servers[server_id]
    save_servers(servers)
    return {"success": True}


@router.post("/servers/{server_id}/test")
async def test_connection(server_id: str, _user=Depends(get_current_user)):
    cfg = get_server(server_id)
    try:
        conn = connect(cfg)
        conn.close()
        return {"success": True, "message": "Connection successful"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Database management ───────────────────────────────────────

@router.get("/servers/{server_id}/databases")
async def list_databases(server_id: str, _user=Depends(get_current_user)):
    cfg = get_server(server_id)
    if cfg["type"] == "mysql":
        result = execute_query(cfg, "SHOW DATABASES")
        return [r[0] for r in result["rows"]]
    else:
        result = execute_query(cfg, "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
        return [r[0] for r in result["rows"]]


@router.post("/databases/create")
async def create_database(req: CreateDatabaseRequest, _user=Depends(get_current_user)):
    cfg = get_server(req.server_id)
    if cfg["type"] == "mysql":
        sql = f"CREATE DATABASE `{req.database}` CHARACTER SET {req.charset} COLLATE {req.charset}_unicode_ci"
    else:
        sql = f'CREATE DATABASE "{req.database}" ENCODING \'{req.encoding}\''
    execute_query(cfg, sql)
    return {"success": True}


@router.delete("/databases/{server_id}/{database}")
async def drop_database(server_id: str, database: str, _user=Depends(get_current_user)):
    cfg = get_server(server_id)
    if cfg["type"] == "mysql":
        sql = f"DROP DATABASE `{database}`"
    else:
        sql = f'DROP DATABASE "{database}"'
    execute_query(cfg, sql)
    return {"success": True}


# ── Table management ──────────────────────────────────────────

@router.get("/servers/{server_id}/databases/{database}/tables")
async def list_tables(server_id: str, database: str, _user=Depends(get_current_user)):
    cfg = get_server(server_id)
    if cfg["type"] == "mysql":
        result = execute_query(cfg, "SHOW TABLES", database=database)
        return [{"name": r[0], "type": "table"} for r in result["rows"]]
    else:
        result = execute_query(
            cfg,
            "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
            database=database,
        )
        return [{"name": r[0], "type": r[1]} for r in result["rows"]]


@router.get("/servers/{server_id}/databases/{database}/tables/{table}/rows")
async def get_rows(
    server_id: str, database: str, table: str,
    limit: int = 100, offset: int = 0,
    _user=Depends(get_current_user)
):
    cfg = get_server(server_id)
    if cfg["type"] == "mysql":
        count_sql = f"SELECT COUNT(*) FROM `{table}`"
        data_sql = f"SELECT * FROM `{table}` LIMIT {limit} OFFSET {offset}"
    else:
        count_sql = f'SELECT COUNT(*) FROM "{table}"'
        data_sql = f'SELECT * FROM "{table}" LIMIT {limit} OFFSET {offset}'

    count_res = execute_query(cfg, count_sql, database=database)
    total = count_res["rows"][0][0]
    data_res = execute_query(cfg, data_sql, database=database)
    return {**data_res, "total": total, "offset": offset, "limit": limit}


@router.delete("/servers/{server_id}/databases/{database}/tables/{table}")
async def drop_table(server_id: str, database: str, table: str, _user=Depends(get_current_user)):
    cfg = get_server(server_id)
    if cfg["type"] == "mysql":
        sql = f"DROP TABLE `{table}`"
    else:
        sql = f'DROP TABLE "{table}"'
    execute_query(cfg, sql, database=database)
    return {"success": True}


# ── User management ───────────────────────────────────────────

@router.get("/servers/{server_id}/users")
async def list_users(server_id: str, _user=Depends(get_current_user)):
    cfg = get_server(server_id)
    if cfg["type"] == "mysql":
        result = execute_query(cfg, "SELECT user, host FROM mysql.user ORDER BY user")
        return [{"user": r[0], "host": r[1]} for r in result["rows"]]
    else:
        result = execute_query(cfg, "SELECT usename, usesuper, usecreatedb FROM pg_user ORDER BY usename")
        return [{"user": r[0], "superuser": r[1], "createdb": r[2]} for r in result["rows"]]


@router.post("/users/create")
async def create_user(req: CreateUserRequest, _user=Depends(get_current_user)):
    cfg = get_server(req.server_id)
    if cfg["type"] == "mysql":
        execute_query(cfg, f"CREATE USER '{req.username}'@'{req.host}' IDENTIFIED BY '{req.password}'")
        execute_query(cfg, "FLUSH PRIVILEGES")
    else:
        execute_query(cfg, f"CREATE USER \"{req.username}\" WITH PASSWORD '{req.password}'")
    return {"success": True}


@router.delete("/users/{server_id}/{username}")
async def drop_user(server_id: str, username: str, host: str = "%", _user=Depends(get_current_user)):
    cfg = get_server(server_id)
    if cfg["type"] == "mysql":
        execute_query(cfg, f"DROP USER '{username}'@'{host}'")
        execute_query(cfg, "FLUSH PRIVILEGES")
    else:
        execute_query(cfg, f'DROP USER "{username}"')
    return {"success": True}


@router.post("/users/grant")
async def grant_privileges(req: GrantRequest, _user=Depends(get_current_user)):
    cfg = get_server(req.server_id)
    if cfg["type"] == "mysql":
        execute_query(cfg, f"GRANT {req.privileges} ON `{req.database}`.* TO '{req.username}'@'{req.host}'")
        execute_query(cfg, "FLUSH PRIVILEGES")
    else:
        execute_query(cfg, f'GRANT {req.privileges} ON DATABASE "{req.database}" TO "{req.username}"', database=req.database)
        # Also grant on schema
        execute_query(cfg, f'GRANT {req.privileges} ON ALL TABLES IN SCHEMA public TO "{req.username}"', database=req.database)
    return {"success": True}


@router.post("/users/revoke")
async def revoke_privileges(req: RevokeRequest, _user=Depends(get_current_user)):
    cfg = get_server(req.server_id)
    if cfg["type"] == "mysql":
        execute_query(cfg, f"REVOKE {req.privileges} ON `{req.database}`.* FROM '{req.username}'@'{req.host}'")
        execute_query(cfg, "FLUSH PRIVILEGES")
    else:
        execute_query(cfg, f'REVOKE {req.privileges} ON DATABASE "{req.database}" FROM "{req.username}"')
    return {"success": True}


@router.get("/users/{server_id}/{username}/grants")
async def show_grants(server_id: str, username: str, host: str = "%", _user=Depends(get_current_user)):
    cfg = get_server(server_id)
    if cfg["type"] == "mysql":
        result = execute_query(cfg, f"SHOW GRANTS FOR '{username}'@'{host}'")
        return {"grants": [r[0] for r in result["rows"]]}
    else:
        result = execute_query(cfg, f"SELECT * FROM information_schema.role_table_grants WHERE grantee = '{username}'")
        return {"grants": result["rows"], "columns": result["columns"]}


# ── Query ─────────────────────────────────────────────────────

@router.post("/query")
async def run_query(req: QueryRequest, _user=Depends(get_current_user)):
    cfg = get_server(req.server_id)
    return execute_query(cfg, req.sql, database=req.database)
