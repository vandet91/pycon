"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { getToken } from "@/lib/api";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const PAGE_SIZE = 100;

function authHeaders(json = false) {
  return {
    Authorization: `Bearer ${getToken()}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(true), ...(init.headers as any) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────
interface Server { id: string; name: string; type: string; host: string; port: number; user: string }
interface DBFile { name: string; path: string; rel_path: string; size: number }
interface TableInfo { name: string; type: string }
interface RowResult { columns: string[]; rows: any[][]; total?: number; rowcount?: number }
interface QueryResult { type: string; columns?: string[]; rows?: any[][]; rowcount: number; message?: string }
interface DBUser { user: string; host?: string; superuser?: boolean; createdb?: boolean }

// ── Helpers ───────────────────────────────────────────────────
function Btn({ children, onClick, color = "blue", disabled = false, small = false }: any) {
  const colors: Record<string, string> = {
    blue: "bg-blue-600 hover:bg-blue-500 text-white",
    green: "bg-green-700 hover:bg-green-600 text-white",
    red: "bg-red-800 hover:bg-red-700 text-white",
    gray: "border border-border text-muted hover:text-white",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${small ? "text-xs px-2.5 py-1" : "text-sm px-4 py-1.5"} rounded transition-colors disabled:opacity-40 ${colors[color]}`}
    >
      {children}
    </button>
  );
}

function Modal({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-panel border border-border rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="font-semibold text-white text-sm">{title}</h3>
          <button onClick={onClose} className="text-muted hover:text-white text-xl">×</button>
        </div>
        <div className="px-6 py-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: any) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = "text" }: any) {
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-blue-500"
    />
  );
}

function DataTable({ columns, rows, onDelete }: { columns: string[]; rows: any[][]; onDelete?: (row: any[]) => void }) {
  if (!rows.length) return <div className="p-6 text-center text-muted text-sm">No rows</div>;
  return (
    <table className="w-full text-xs border-collapse">
      <thead className="sticky top-0 bg-panel z-10">
        <tr>
          {columns.map((c) => (
            <th key={c} className="text-left px-3 py-2 border-b border-border text-muted font-medium whitespace-nowrap">{c}</th>
          ))}
          {onDelete && <th className="px-3 py-2 border-b border-border w-8" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-border/40 hover:bg-white/2 group">
            {row.map((cell, j) => (
              <td key={j} className="px-3 py-1.5 font-mono text-gray-300 whitespace-nowrap max-w-xs truncate">
                {cell === null ? <span className="text-muted italic">NULL</span> : String(cell)}
              </td>
            ))}
            {onDelete && (
              <td className="px-2">
                <button onClick={() => onDelete(row)} className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 text-xs">✕</button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main page ─────────────────────────────────────────────────
type Mode = "sqlite" | "server";
type ServerTab = "databases" | "users" | "query";

export default function DatabasePage() {
  const [mode, setMode] = useState<Mode>("sqlite");

  // SQLite state
  const [sqliteFiles, setSqliteFiles] = useState<DBFile[]>([]);
  const [selSqlite, setSelSqlite] = useState<DBFile | null>(null);
  const [sqliteTables, setSqliteTables] = useState<TableInfo[]>([]);
  const [selSqliteTable, setSelSqliteTable] = useState("");
  const [sqliteRows, setSqliteRows] = useState<RowResult | null>(null);
  const [sqliteOffset, setSqliteOffset] = useState(0);
  const [sqliteTab, setSqliteTab] = useState<"browse" | "query">("browse");
  const [sqliteSql, setSqliteSql] = useState("SELECT * FROM ");
  const [sqliteResult, setSqliteResult] = useState<QueryResult | null>(null);

  // Server state
  const [servers, setServers] = useState<Server[]>([]);
  const [selServer, setSelServer] = useState<Server | null>(null);
  const [serverTab, setServerTab] = useState<ServerTab>("databases");
  const [databases, setDatabases] = useState<string[]>([]);
  const [selDatabase, setSelDatabase] = useState("");
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selTable, setSelTable] = useState("");
  const [tableRows, setTableRows] = useState<RowResult | null>(null);
  const [tableOffset, setTableOffset] = useState(0);
  const [users, setUsers] = useState<DBUser[]>([]);
  const [userGrants, setUserGrants] = useState<{ user: string; grants: string[] } | null>(null);
  const [serverSql, setServerSql] = useState("SELECT 1");
  const [serverResult, setServerResult] = useState<QueryResult | null>(null);

  // Modals
  const [modal, setModal] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Forms
  const [serverForm, setServerForm] = useState({ name: "", type: "mysql", host: "", port: "", user: "", password: "", save_password: true });
  const [dbForm, setDbForm] = useState({ database: "", charset: "utf8mb4", encoding: "UTF8" });
  const [userForm, setUserForm] = useState({ username: "", password: "", host: "%" });
  const [grantForm, setGrantForm] = useState({ username: "", database: "", privileges: "ALL PRIVILEGES", host: "%" });

  // ── Load data ─────────────────────────────────────────────
  useEffect(() => {
    apiFetch("/api/database/sqlite/list").then(setSqliteFiles).catch(() => {});
    apiFetch("/api/dbserver/servers").then(setServers).catch(() => {});
  }, []);

  async function selectSqlite(db: DBFile) {
    setSelSqlite(db); setSelSqliteTable(""); setSqliteRows(null); setError("");
    const tables = await apiFetch(`/api/database/sqlite/tables?path=${encodeURIComponent(db.path)}`);
    setSqliteTables(tables);
  }

  async function selectSqliteTable(table: string) {
    if (!selSqlite) return;
    setSelSqliteTable(table); setSqliteOffset(0); setError("");
    const [, rows] = await Promise.all([
      apiFetch(`/api/database/sqlite/table-info?path=${encodeURIComponent(selSqlite.path)}&table=${encodeURIComponent(table)}`),
      apiFetch(`/api/database/sqlite/rows?path=${encodeURIComponent(selSqlite.path)}&table=${encodeURIComponent(table)}&limit=${PAGE_SIZE}&offset=0`),
    ]);
    setSqliteRows(rows);
    setSqliteSql(`SELECT * FROM \`${table}\` LIMIT 100`);
  }

  async function selectServer(s: Server) {
    setSelServer(s); setDatabases([]); setSelDatabase(""); setTables([]); setSelTable(""); setError("");
    const dbs = await apiFetch(`/api/dbserver/servers/${s.id}/databases`);
    setDatabases(dbs);
    const us = await apiFetch(`/api/dbserver/servers/${s.id}/users`);
    setUsers(us);
  }

  async function selectDatabase(db: string) {
    if (!selServer) return;
    setSelDatabase(db); setTables([]); setSelTable(""); setTableRows(null);
    const tbls = await apiFetch(`/api/dbserver/servers/${selServer.id}/databases/${db}/tables`);
    setTables(tbls);
    setServerSql(`SELECT * FROM \`${db}\`.\`table_name\` LIMIT 100`);
  }

  async function selectTable(table: string) {
    if (!selServer || !selDatabase) return;
    setSelTable(table); setTableOffset(0);
    const rows = await apiFetch(`/api/dbserver/servers/${selServer.id}/databases/${selDatabase}/tables/${table}/rows?limit=${PAGE_SIZE}&offset=0`);
    setTableRows(rows);
  }

  async function loadTablePage(off: number) {
    if (!selServer || !selDatabase || !selTable) return;
    const rows = await apiFetch(`/api/dbserver/servers/${selServer.id}/databases/${selDatabase}/tables/${selTable}/rows?limit=${PAGE_SIZE}&offset=${off}`);
    setTableRows(rows); setTableOffset(off);
  }

  // ── Actions ───────────────────────────────────────────────

  async function addServer() {
    setLoading(true); setError("");
    try {
      await apiFetch("/api/dbserver/servers", {
        method: "POST",
        body: JSON.stringify({ ...serverForm, port: parseInt(serverForm.port) || null }),
      });
      const updated = await apiFetch("/api/dbserver/servers");
      setServers(updated); setModal(""); setServerForm({ name: "", type: "mysql", host: "", port: "", user: "", password: "", save_password: true });
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function deleteServer(id: string) {
    if (!confirm("Remove this server connection?")) return;
    await apiFetch(`/api/dbserver/servers/${id}`, { method: "DELETE" });
    setServers((s) => s.filter((x) => x.id !== id));
    if (selServer?.id === id) setSelServer(null);
  }

  async function createDatabase() {
    if (!selServer) return;
    setLoading(true); setError("");
    try {
      await apiFetch("/api/dbserver/databases/create", {
        method: "POST",
        body: JSON.stringify({ server_id: selServer.id, ...dbForm }),
      });
      const dbs = await apiFetch(`/api/dbserver/servers/${selServer.id}/databases`);
      setDatabases(dbs); setModal(""); setDbForm({ database: "", charset: "utf8mb4", encoding: "UTF8" });
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function dropDatabase(db: string) {
    if (!selServer || !confirm(`Drop database "${db}"? This cannot be undone!`)) return;
    await apiFetch(`/api/dbserver/databases/${selServer.id}/${db}`, { method: "DELETE" });
    setDatabases((d) => d.filter((x) => x !== db));
    if (selDatabase === db) { setSelDatabase(""); setTables([]); }
  }

  async function createUser() {
    if (!selServer) return;
    setLoading(true); setError("");
    try {
      await apiFetch("/api/dbserver/users/create", {
        method: "POST",
        body: JSON.stringify({ server_id: selServer.id, ...userForm }),
      });
      const us = await apiFetch(`/api/dbserver/servers/${selServer.id}/users`);
      setUsers(us); setModal(""); setUserForm({ username: "", password: "", host: "%" });
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function dropUser(username: string, host = "%") {
    if (!selServer || !confirm(`Drop user "${username}"?`)) return;
    await apiFetch(`/api/dbserver/users/${selServer.id}/${username}?host=${host}`, { method: "DELETE" });
    setUsers((u) => u.filter((x) => x.user !== username));
  }

  async function grantPrivileges() {
    if (!selServer) return;
    setLoading(true); setError("");
    try {
      await apiFetch("/api/dbserver/users/grant", {
        method: "POST",
        body: JSON.stringify({ server_id: selServer.id, ...grantForm }),
      });
      setModal("");
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function revokePrivileges() {
    if (!selServer) return;
    setLoading(true); setError("");
    try {
      await apiFetch("/api/dbserver/users/revoke", {
        method: "POST",
        body: JSON.stringify({ server_id: selServer.id, ...grantForm }),
      });
      setModal("");
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function showGrants(u: DBUser) {
    if (!selServer) return;
    const data = await apiFetch(`/api/dbserver/users/${selServer.id}/${u.user}/grants?host=${u.host || "%"}`);
    setUserGrants({ user: u.user, grants: data.grants });
    setModal("grants");
  }

  async function runServerQuery() {
    if (!selServer) return;
    setLoading(true); setError(""); setServerResult(null);
    try {
      const result = await apiFetch("/api/dbserver/query", {
        method: "POST",
        body: JSON.stringify({ server_id: selServer.id, database: selDatabase || null, sql: serverSql }),
      });
      setServerResult(result);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function runSqliteQuery() {
    if (!selSqlite) return;
    setLoading(true); setError(""); setSqliteResult(null);
    try {
      const result = await apiFetch("/api/database/sqlite/query", {
        method: "POST",
        body: JSON.stringify({ path: selSqlite.path, sql: sqliteSql }),
      });
      setSqliteResult(result);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  const totalPages = tableRows?.total ? Math.ceil(tableRows.total / PAGE_SIZE) : 0;

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="flex h-screen">

      {/* ── Left sidebar ────────────────────────────────── */}
      <div className="w-64 shrink-0 bg-panel border-r border-border flex flex-col">

        {/* Mode toggle */}
        <div className="p-3 border-b border-border flex gap-1">
          <button onClick={() => setMode("sqlite")}
            className={`flex-1 text-xs py-1.5 rounded transition-colors ${mode === "sqlite" ? "bg-blue-600 text-white" : "text-muted hover:text-white"}`}>
            🗂 SQLite
          </button>
          <button onClick={() => setMode("server")}
            className={`flex-1 text-xs py-1.5 rounded transition-colors ${mode === "server" ? "bg-blue-600 text-white" : "text-muted hover:text-white"}`}>
            🖥 Servers
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">

          {/* SQLite mode */}
          {mode === "sqlite" && (
            sqliteFiles.length === 0
              ? <div className="px-4 py-6 text-xs text-muted text-center">No .db files found in projects</div>
              : sqliteFiles.map((db) => (
                <div key={db.path}>
                  <button onClick={() => selectSqlite(db)}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${selSqlite?.path === db.path ? "bg-blue-600/20 text-blue-300" : "text-gray-300 hover:bg-white/5"}`}>
                    <span>🗄</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono truncate">{db.name}</div>
                      <div className="text-muted truncate">{db.rel_path}</div>
                    </div>
                  </button>
                  {selSqlite?.path === db.path && sqliteTables.map((t) => (
                    <button key={t.name} onClick={() => selectSqliteTable(t.name)}
                      className={`w-full text-left pl-8 pr-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${selSqliteTable === t.name ? "bg-blue-600/20 text-blue-300" : "text-gray-400 hover:bg-white/5"}`}>
                      <span className="text-muted">▤</span>
                      <span className="font-mono truncate">{t.name}</span>
                    </button>
                  ))}
                </div>
              ))
          )}

          {/* Server mode */}
          {mode === "server" && (
            <>
              <div className="px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-muted">Connections</span>
                <button onClick={() => setModal("add-server")}
                  className="text-xs text-blue-400 hover:text-blue-300">+ Add</button>
              </div>
              {servers.map((s) => (
                <div key={s.id}>
                  <div className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${selServer?.id === s.id ? "bg-blue-600/20 text-blue-300" : "text-gray-300 hover:bg-white/5"}`}
                    onClick={() => selectServer(s)}>
                    <span className="text-sm">{s.type === "mysql" ? "🐬" : "🐘"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{s.name}</div>
                      <div className="text-xs text-muted truncate">{s.host}:{s.port}</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); deleteServer(s.id); }}
                      className="text-muted hover:text-red-400 text-xs opacity-0 group-hover:opacity-100">✕</button>
                  </div>
                  {/* Databases under selected server */}
                  {selServer?.id === s.id && databases.map((db) => (
                    <div key={db}>
                      <button onClick={() => { setServerTab("databases"); selectDatabase(db); }}
                        className={`w-full text-left pl-8 pr-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${selDatabase === db ? "bg-blue-600/20 text-blue-300" : "text-gray-400 hover:bg-white/5"}`}>
                        <span className="text-muted">🗃</span>
                        <span className="font-mono truncate">{db}</span>
                      </button>
                      {selDatabase === db && tables.map((t) => (
                        <button key={t.name} onClick={() => selectTable(t.name)}
                          className={`w-full text-left pl-14 pr-3 py-1 text-xs flex items-center gap-2 transition-colors ${selTable === t.name ? "bg-blue-600/20 text-blue-300" : "text-gray-400 hover:bg-white/5"}`}>
                          <span className="text-muted">▤</span>
                          <span className="font-mono truncate">{t.name}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
              {servers.length === 0 && (
                <div className="px-4 py-6 text-xs text-muted text-center">No servers yet.<br />Click + Add to connect.</div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Main panel ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* SQLite panel */}
        {mode === "sqlite" && (
          !selSqlite
            ? <div className="flex-1 flex items-center justify-center text-muted text-sm">Select a SQLite database</div>
            : <>
              <div className="bg-panel border-b border-border px-5 py-2.5 flex items-center gap-3 shrink-0">
                <span className="text-xs font-mono text-white">{selSqlite.name}</span>
                {selSqliteTable && <><span className="text-muted">→</span><span className="text-xs font-mono text-blue-400">{selSqliteTable}</span></>}
                <div className="ml-auto flex gap-2">
                  <Btn small color="gray" onClick={() => setSqliteTab("browse")}>Browse</Btn>
                  <Btn small color="gray" onClick={() => setSqliteTab("query")}>SQL</Btn>
                </div>
              </div>
              {error && <div className="mx-5 mt-3 text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">{error}</div>}
              {sqliteTab === "browse" && (
                <div className="flex-1 overflow-auto">
                  {sqliteRows
                    ? <DataTable columns={sqliteRows.columns} rows={sqliteRows.rows} />
                    : <div className="flex-1 flex items-center justify-center text-muted text-sm p-10">Select a table</div>
                  }
                </div>
              )}
              {sqliteTab === "query" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="h-40 border-b border-border shrink-0">
                    <MonacoEditor height="100%" language="sql" theme="vs-dark" value={sqliteSql}
                      onChange={(v) => setSqliteSql(v ?? "")}
                      options={{ fontSize: 13, minimap: { enabled: false }, lineNumbers: "off", scrollBeyondLastLine: false }} />
                  </div>
                  <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-3 bg-panel">
                    <Btn onClick={runSqliteQuery} disabled={loading}>▶ Run</Btn>
                    {sqliteResult && <span className="text-xs text-green-400">{sqliteResult.rowcount} rows</span>}
                    {error && <span className="text-xs text-red-400">{error}</span>}
                  </div>
                  <div className="flex-1 overflow-auto">
                    {sqliteResult?.type === "select" && sqliteResult.columns && (
                      <DataTable columns={sqliteResult.columns} rows={sqliteResult.rows ?? []} />
                    )}
                    {sqliteResult?.type === "modify" && (
                      <div className="p-5 text-sm text-green-400">✅ {sqliteResult.message}</div>
                    )}
                  </div>
                </div>
              )}
            </>
        )}

        {/* Server panel */}
        {mode === "server" && (
          !selServer
            ? <div className="flex-1 flex items-center justify-center text-muted text-sm">Select or add a server connection</div>
            : <>
              {/* Tab bar */}
              <div className="bg-panel border-b border-border px-5 py-2.5 flex items-center gap-1 shrink-0">
                <span className="text-xs font-mono text-white mr-3">{selServer.name}</span>
                {(["databases", "users", "query"] as ServerTab[]).map((t) => (
                  <button key={t} onClick={() => setServerTab(t)}
                    className={`text-xs px-3 py-1 rounded capitalize transition-colors ${serverTab === t ? "bg-blue-600 text-white" : "text-muted hover:text-white"}`}>
                    {t === "databases" ? "🗃 Databases" : t === "users" ? "👤 Users" : "⌨ Query"}
                  </button>
                ))}
              </div>

              {error && <div className="mx-5 mt-3 text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">{error}</div>}

              {/* Databases tab */}
              {serverTab === "databases" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="px-5 py-3 border-b border-border flex items-center gap-3 shrink-0">
                    <Btn small onClick={() => setModal("create-db")}>+ New Database</Btn>
                    {selDatabase && (
                      <>
                        <span className="text-xs text-muted">Selected: <strong className="text-blue-400">{selDatabase}</strong></span>
                        <Btn small color="red" onClick={() => dropDatabase(selDatabase)}>Drop DB</Btn>
                      </>
                    )}
                  </div>

                  {!selDatabase ? (
                    <div className="p-5">
                      <div className="text-xs text-muted mb-3">Databases on {selServer.host}</div>
                      <div className="grid grid-cols-3 gap-2">
                        {databases.map((db) => (
                          <button key={db} onClick={() => selectDatabase(db)}
                            className="bg-surface border border-border rounded-lg px-3 py-3 text-left hover:border-blue-500 transition-colors group">
                            <div className="text-sm">🗃</div>
                            <div className="text-xs font-mono text-white mt-1 truncate">{db}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="px-5 py-2 border-b border-border text-xs text-muted shrink-0">
                        Tables in <strong className="text-blue-400">{selDatabase}</strong>
                        {selTable && <> → <strong className="text-white">{selTable}</strong></>}
                        {tableRows?.total !== undefined && <span className="ml-2">({tableRows.total.toLocaleString()} rows)</span>}
                      </div>
                      <div className="flex-1 overflow-auto">
                        {selTable && tableRows
                          ? <DataTable columns={tableRows.columns} rows={tableRows.rows} />
                          : (
                            <div className="p-5 grid grid-cols-3 gap-2">
                              {tables.map((t) => (
                                <button key={t.name} onClick={() => selectTable(t.name)}
                                  className="bg-surface border border-border rounded-lg px-3 py-3 text-left hover:border-blue-500 transition-colors">
                                  <div className="text-sm">▤</div>
                                  <div className="text-xs font-mono text-white mt-1 truncate">{t.name}</div>
                                </button>
                              ))}
                            </div>
                          )
                        }
                      </div>
                      {tableRows && tableRows.total !== undefined && tableRows.total > PAGE_SIZE && (
                        <div className="border-t border-border px-4 py-2 flex items-center gap-3 text-xs text-muted shrink-0 bg-panel">
                          <span>{tableOffset + 1}–{Math.min(tableOffset + PAGE_SIZE, tableRows.total)} of {tableRows.total}</span>
                          <div className="ml-auto flex gap-2">
                            <Btn small color="gray" disabled={tableOffset === 0} onClick={() => loadTablePage(tableOffset - PAGE_SIZE)}>← Prev</Btn>
                            <Btn small color="gray" disabled={tableOffset + PAGE_SIZE >= tableRows.total} onClick={() => loadTablePage(tableOffset + PAGE_SIZE)}>Next →</Btn>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Users tab */}
              {serverTab === "users" && (
                <div className="flex-1 overflow-auto">
                  <div className="px-5 py-3 border-b border-border flex gap-2 shrink-0">
                    <Btn small onClick={() => setModal("create-user")}>+ New User</Btn>
                    <Btn small color="green" onClick={() => setModal("grant")}>Grant Permissions</Btn>
                    <Btn small color="gray" onClick={() => setModal("revoke")}>Revoke</Btn>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted">
                        <th className="text-left px-5 py-2.5 font-medium">Username</th>
                        {selServer.type === "mysql" && <th className="text-left px-5 py-2.5 font-medium">Host</th>}
                        {selServer.type === "postgres" && <th className="text-left px-5 py-2.5 font-medium">Superuser</th>}
                        <th className="text-right px-5 py-2.5 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.user + (u.host || "")} className="border-b border-border/50 hover:bg-white/2">
                          <td className="px-5 py-2.5 font-mono text-white">{u.user}</td>
                          {selServer.type === "mysql" && <td className="px-5 py-2.5 text-muted">{u.host}</td>}
                          {selServer.type === "postgres" && <td className="px-5 py-2.5">{u.superuser ? "✅" : "—"}</td>}
                          <td className="px-5 py-2.5 flex justify-end gap-2">
                            <Btn small color="gray" onClick={() => showGrants(u)}>Grants</Btn>
                            <Btn small color="red" onClick={() => dropUser(u.user, u.host)}>Drop</Btn>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Query tab */}
              {serverTab === "query" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="h-44 border-b border-border shrink-0">
                    <MonacoEditor height="100%" language="sql" theme="vs-dark" value={serverSql}
                      onChange={(v) => setServerSql(v ?? "")}
                      options={{ fontSize: 13, minimap: { enabled: false }, lineNumbers: "off", scrollBeyondLastLine: false }} />
                  </div>
                  <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-3 bg-panel">
                    <Btn onClick={runServerQuery} disabled={loading}>▶ Run</Btn>
                    {selDatabase && <span className="text-xs text-muted">on <strong className="text-blue-400">{selDatabase}</strong></span>}
                    {serverResult && <span className="text-xs text-green-400 ml-auto">{serverResult.rowcount} rows</span>}
                    {error && <span className="text-xs text-red-400 ml-auto">{error}</span>}
                  </div>
                  <div className="flex-1 overflow-auto">
                    {serverResult?.type === "select" && serverResult.columns && (
                      <DataTable columns={serverResult.columns} rows={serverResult.rows ?? []} />
                    )}
                    {serverResult?.type === "modify" && (
                      <div className="p-5 text-sm text-green-400">✅ {serverResult.message}</div>
                    )}
                    {!serverResult && (
                      <div className="p-5 text-xs text-muted">
                        Write SQL and click Run.<br /><br />
                        <code className="text-blue-400">SHOW DATABASES</code><br />
                        <code className="text-blue-400">CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100))</code><br />
                        <code className="text-blue-400">SELECT * FROM users LIMIT 10</code>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────── */}

      {modal === "add-server" && (
        <Modal title="Add Database Server" onClose={() => { setModal(""); setError(""); }}>
          {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">{error}</div>}
          <Field label="Name"><Input value={serverForm.name} onChange={(e: any) => setServerForm({ ...serverForm, name: e.target.value })} placeholder="My MySQL Server" /></Field>
          <Field label="Type">
            <select value={serverForm.type} onChange={(e) => setServerForm({ ...serverForm, type: e.target.value })}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white">
              <option value="mysql">🐬 MySQL / MariaDB</option>
              <option value="postgres">🐘 PostgreSQL</option>
            </select>
          </Field>
          <div className="flex gap-2">
            <div className="flex-1"><Field label="Host"><Input value={serverForm.host} onChange={(e: any) => setServerForm({ ...serverForm, host: e.target.value })} placeholder="localhost" /></Field></div>
            <div className="w-24"><Field label="Port"><Input value={serverForm.port} onChange={(e: any) => setServerForm({ ...serverForm, port: e.target.value })} placeholder={serverForm.type === "mysql" ? "3306" : "5432"} /></Field></div>
          </div>
          <Field label="Username"><Input value={serverForm.user} onChange={(e: any) => setServerForm({ ...serverForm, user: e.target.value })} placeholder="root" /></Field>
          <Field label="Password"><Input type="password" value={serverForm.password} onChange={(e: any) => setServerForm({ ...serverForm, password: e.target.value })} placeholder="••••••••" /></Field>
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
            <input type="checkbox" checked={serverForm.save_password} onChange={(e) => setServerForm({ ...serverForm, save_password: e.target.checked })} />
            Save password
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Btn color="gray" onClick={() => setModal("")}>Cancel</Btn>
            <Btn onClick={addServer} disabled={loading}>{loading ? "Connecting…" : "Connect & Save"}</Btn>
          </div>
        </Modal>
      )}

      {modal === "create-db" && (
        <Modal title="Create Database" onClose={() => { setModal(""); setError(""); }}>
          {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">{error}</div>}
          <Field label="Database Name"><Input value={dbForm.database} onChange={(e: any) => setDbForm({ ...dbForm, database: e.target.value })} placeholder="my_database" /></Field>
          {selServer?.type === "mysql" && (
            <Field label="Charset"><Input value={dbForm.charset} onChange={(e: any) => setDbForm({ ...dbForm, charset: e.target.value })} placeholder="utf8mb4" /></Field>
          )}
          {selServer?.type === "postgres" && (
            <Field label="Encoding"><Input value={dbForm.encoding} onChange={(e: any) => setDbForm({ ...dbForm, encoding: e.target.value })} placeholder="UTF8" /></Field>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Btn color="gray" onClick={() => setModal("")}>Cancel</Btn>
            <Btn color="green" onClick={createDatabase} disabled={loading}>{loading ? "Creating…" : "Create"}</Btn>
          </div>
        </Modal>
      )}

      {modal === "create-user" && (
        <Modal title="Create User" onClose={() => { setModal(""); setError(""); }}>
          {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">{error}</div>}
          <Field label="Username"><Input value={userForm.username} onChange={(e: any) => setUserForm({ ...userForm, username: e.target.value })} placeholder="myuser" /></Field>
          <Field label="Password"><Input type="password" value={userForm.password} onChange={(e: any) => setUserForm({ ...userForm, password: e.target.value })} placeholder="••••••••" /></Field>
          {selServer?.type === "mysql" && (
            <Field label="Host (% = any)"><Input value={userForm.host} onChange={(e: any) => setUserForm({ ...userForm, host: e.target.value })} placeholder="%" /></Field>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Btn color="gray" onClick={() => setModal("")}>Cancel</Btn>
            <Btn color="green" onClick={createUser} disabled={loading}>{loading ? "Creating…" : "Create User"}</Btn>
          </div>
        </Modal>
      )}

      {(modal === "grant" || modal === "revoke") && (
        <Modal title={modal === "grant" ? "Grant Permissions" : "Revoke Permissions"} onClose={() => { setModal(""); setError(""); }}>
          {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">{error}</div>}
          <Field label="Username">
            <select value={grantForm.username} onChange={(e) => setGrantForm({ ...grantForm, username: e.target.value })}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white">
              <option value="">— Select user —</option>
              {users.map((u) => <option key={u.user} value={u.user}>{u.user}</option>)}
            </select>
          </Field>
          <Field label="Database">
            <select value={grantForm.database} onChange={(e) => setGrantForm({ ...grantForm, database: e.target.value })}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white">
              <option value="">— Select database —</option>
              {databases.map((db) => <option key={db} value={db}>{db}</option>)}
            </select>
          </Field>
          <Field label="Privileges">
            <select value={grantForm.privileges} onChange={(e) => setGrantForm({ ...grantForm, privileges: e.target.value })}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white">
              <option>ALL PRIVILEGES</option>
              <option>SELECT</option>
              <option>SELECT, INSERT</option>
              <option>SELECT, INSERT, UPDATE</option>
              <option>SELECT, INSERT, UPDATE, DELETE</option>
            </select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Btn color="gray" onClick={() => setModal("")}>Cancel</Btn>
            <Btn color={modal === "grant" ? "green" : "red"} onClick={modal === "grant" ? grantPrivileges : revokePrivileges} disabled={loading}>
              {loading ? "…" : modal === "grant" ? "Grant" : "Revoke"}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === "grants" && userGrants && (
        <Modal title={`Grants for ${userGrants.user}`} onClose={() => setModal("")}>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {userGrants.grants.map((g, i) => (
              <div key={i} className="text-xs font-mono bg-surface rounded px-3 py-2 text-gray-300">{g}</div>
            ))}
          </div>
          <div className="flex justify-end pt-2">
            <Btn color="gray" onClick={() => setModal("")}>Close</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
