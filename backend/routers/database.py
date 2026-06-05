import sqlite3
import os
import json
from typing import Optional, List, Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from config import settings

router = APIRouter(prefix="/database", tags=["database"])


# ── Helpers ───────────────────────────────────────────────────

def find_sqlite_files(base: str) -> list[dict]:
    """Recursively find all .db / .sqlite files under base."""
    results = []
    for root, dirs, files in os.walk(base):
        # Skip venv folders
        dirs[:] = [d for d in dirs if d != "venv" and not d.startswith(".")]
        for f in files:
            if f.endswith((".db", ".sqlite", ".sqlite3")):
                full = os.path.join(root, f)
                rel = os.path.relpath(full, base)
                results.append({
                    "name": f,
                    "path": full,
                    "rel_path": rel,
                    "size": os.path.getsize(full),
                })
    return sorted(results, key=lambda x: x["rel_path"])


def get_sqlite_conn(path: str):
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Database file not found")
    base = os.path.realpath(settings.SERVICES_BASE_DIR)
    real = os.path.realpath(path)
    if not real.startswith(base):
        raise HTTPException(status_code=403, detail="Access denied")
    return sqlite3.connect(real)


# ── Models ────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    path: str
    sql: str
    params: Optional[List[Any]] = []


class ExternalDBRequest(BaseModel):
    type: str        # mysql or postgres
    host: str
    port: int
    user: str
    password: str
    database: str


class ColumnDef(BaseModel):
    name: str
    type: str           # TEXT, INTEGER, REAL, BLOB, VARCHAR(255), etc.
    primary_key: bool = False
    not_null: bool = False
    default: Optional[str] = None
    autoincrement: bool = False


class CreateTableRequest(BaseModel):
    path: str
    table: str
    columns: List[ColumnDef]


class InsertRowRequest(BaseModel):
    path: str
    table: str
    data: Dict[str, Any]


class UpdateRowRequest(BaseModel):
    path: str
    table: str
    pk_col: str
    pk_val: Any
    data: Dict[str, Any]


# ── SQLite endpoints ──────────────────────────────────────────

@router.get("/sqlite/list")
async def list_databases(_user=Depends(get_current_user)):
    base = os.path.realpath(settings.SERVICES_BASE_DIR)
    return find_sqlite_files(base)


@router.get("/sqlite/tables")
async def list_tables(path: str, _user=Depends(get_current_user)):
    conn = get_sqlite_conn(path)
    try:
        cur = conn.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
        rows = cur.fetchall()
        return [{"name": r[0], "type": r[1]} for r in rows]
    finally:
        conn.close()


@router.get("/sqlite/table-info")
async def table_info(path: str, table: str, _user=Depends(get_current_user)):
    conn = get_sqlite_conn(path)
    try:
        cur = conn.execute(f"PRAGMA table_info(`{table}`)")
        cols = cur.fetchall()
        cur2 = conn.execute(f"SELECT COUNT(*) FROM `{table}`")
        count = cur2.fetchone()[0]
        return {
            "columns": [
                {"cid": c[0], "name": c[1], "type": c[2], "notnull": c[3], "default": c[4], "pk": c[5]}
                for c in cols
            ],
            "row_count": count,
        }
    finally:
        conn.close()


@router.get("/sqlite/rows")
async def get_rows(
    path: str,
    table: str,
    limit: int = 100,
    offset: int = 0,
    _user=Depends(get_current_user),
):
    conn = get_sqlite_conn(path)
    try:
        cur = conn.execute(f"SELECT * FROM `{table}` LIMIT ? OFFSET ?", (limit, offset))
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
        total_cur = conn.execute(f"SELECT COUNT(*) FROM `{table}`")
        total = total_cur.fetchone()[0]
        return {
            "columns": cols,
            "rows": [list(r) for r in rows],
            "total": total,
            "offset": offset,
            "limit": limit,
        }
    finally:
        conn.close()


@router.post("/sqlite/query")
async def run_query(req: QueryRequest, _user=Depends(get_current_user)):
    conn = get_sqlite_conn(req.path)
    try:
        cur = conn.execute(req.sql, req.params or [])
        is_select = req.sql.strip().upper().startswith("SELECT") or \
                    req.sql.strip().upper().startswith("PRAGMA") or \
                    req.sql.strip().upper().startswith("WITH")
        if is_select:
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = cur.fetchall()
            return {
                "type": "select",
                "columns": cols,
                "rows": [list(r) for r in rows],
                "rowcount": len(rows),
            }
        else:
            conn.commit()
            return {
                "type": "modify",
                "rowcount": cur.rowcount,
                "message": f"{cur.rowcount} row(s) affected",
            }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@router.delete("/sqlite/row")
async def delete_row(
    path: str,
    table: str,
    pk_col: str,
    pk_val: str,
    _user=Depends(get_current_user),
):
    conn = get_sqlite_conn(path)
    try:
        cur = conn.execute(f"DELETE FROM `{table}` WHERE `{pk_col}` = ?", (pk_val,))
        conn.commit()
        return {"success": True, "rowcount": cur.rowcount}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@router.get("/sqlite/export")
async def export_table(path: str, table: str, _user=Depends(get_current_user)):
    conn = get_sqlite_conn(path)
    try:
        cur = conn.execute(f"SELECT * FROM `{table}`")
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
        data = [dict(zip(cols, row)) for row in rows]
        return {"table": table, "columns": cols, "data": data, "count": len(data)}
    finally:
        conn.close()


@router.post("/sqlite/table/create")
async def create_table(req: CreateTableRequest, _user=Depends(get_current_user)):
    conn = get_sqlite_conn(req.path)
    try:
        col_defs = []
        for c in req.columns:
            definition = f"`{c.name}` {c.type}"
            if c.primary_key:
                definition += " PRIMARY KEY"
                if c.autoincrement and "INT" in c.type.upper():
                    definition += " AUTOINCREMENT"
            if c.not_null and not c.primary_key:
                definition += " NOT NULL"
            if c.default is not None:
                definition += f" DEFAULT {c.default}"
            col_defs.append(definition)

        sql = f"CREATE TABLE IF NOT EXISTS `{req.table}` ({', '.join(col_defs)})"
        conn.execute(sql)
        conn.commit()
        return {"success": True, "sql": sql}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@router.delete("/sqlite/table")
async def drop_table(path: str, table: str, _user=Depends(get_current_user)):
    conn = get_sqlite_conn(path)
    try:
        conn.execute(f"DROP TABLE IF EXISTS `{table}`")
        conn.commit()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@router.post("/sqlite/row/insert")
async def insert_row(req: InsertRowRequest, _user=Depends(get_current_user)):
    conn = get_sqlite_conn(req.path)
    try:
        cols = list(req.data.keys())
        vals = list(req.data.values())
        placeholders = ", ".join(["?"] * len(cols))
        col_names = ", ".join([f"`{c}`" for c in cols])
        sql = f"INSERT INTO `{req.table}` ({col_names}) VALUES ({placeholders})"
        cur = conn.execute(sql, vals)
        conn.commit()
        return {"success": True, "last_id": cur.lastrowid}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@router.put("/sqlite/row/update")
async def update_row(req: UpdateRowRequest, _user=Depends(get_current_user)):
    conn = get_sqlite_conn(req.path)
    try:
        # Exclude pk from update data
        data = {k: v for k, v in req.data.items() if k != req.pk_col}
        if not data:
            raise HTTPException(status_code=400, detail="No columns to update")
        sets = ", ".join([f"`{k}` = ?" for k in data.keys()])
        vals = list(data.values()) + [req.pk_val]
        sql = f"UPDATE `{req.table}` SET {sets} WHERE `{req.pk_col}` = ?"
        cur = conn.execute(sql, vals)
        conn.commit()
        return {"success": True, "rowcount": cur.rowcount}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()
