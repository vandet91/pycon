"use client";

import { useEffect, useRef, useState } from "react";
import { api, getToken, wsUrl } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Project {
  name: string;
  path: string;
  has_service: boolean;
  has_requirements: boolean;
}

interface DeployForm {
  name: string;
  description: string;
  python_file: string;
  env_vars: string;
}

interface LogLine {
  type: string;
  msg: string;
}

const defaultForm: DeployForm = {
  name: "",
  description: "",
  python_file: "main.py",
  env_vars: "",
};

function LogLine({ line }: { line: LogLine }) {
  const color =
    line.type === "error" ? "text-red-400" :
    line.type === "success" ? "text-green-400" :
    line.type === "step" ? "text-blue-400 font-semibold" :
    line.type === "warn" ? "text-yellow-400" :
    "text-gray-300";
  return <div className={`leading-5 ${color}`}>{line.msg}</div>;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<DeployForm>(defaultForm);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"upload" | "configure" | "deploying">("upload");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  async function fetchProjects() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/projects/list`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      setProjects(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchProjects(); }, []);

  // Auto scroll logs
  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);

  function resetAdd() {
    setShowAdd(false);
    setForm(defaultForm);
    setFile(null);
    setStep("upload");
    setLogs([]);
    setError("");
    setDone(false);
    setWorking(false);
  }

  async function handleUpload() {
    if (!file || !form.name) return;
    setWorking(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(
        `${API_BASE}/api/projects/upload?name=${encodeURIComponent(form.name)}`,
        { method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Upload failed");
      }
      setStep("configure");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  async function handleDeploy() {
    setStep("deploying");
    setLogs([]);
    setDone(false);
    setWorking(true);

    const params = new URLSearchParams({
      name: form.name,
      python_file: form.python_file,
      description: form.description,
      env_vars: form.env_vars,
    });

    const url = wsUrl(`/api/projects/ws/deploy`) + "&" + params.toString();
    const ws = new WebSocket(url);

    ws.onmessage = (e) => {
      try {
        const data: LogLine = JSON.parse(e.data);
        if (data.type === "done") {
          setDone(true);
          setWorking(false);
          fetchProjects();
        } else {
          setLogs((prev) => [...prev, data]);
        }
      } catch {
        setLogs((prev) => [...prev, { type: "log", msg: e.data }]);
      }
    };

    ws.onerror = () => {
      setLogs((prev) => [...prev, { type: "error", msg: "WebSocket connection error" }]);
      setWorking(false);
    };

    ws.onclose = () => {
      setWorking(false);
    };
  }

  async function deleteProject(name: string, deleteFiles: boolean) {
    if (!confirm(`Remove service "${name}"${deleteFiles ? " and delete all files" : ""}?`)) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/${name}?delete_files=${deleteFiles}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Failed: ${data.detail || res.statusText}`);
        return;
      }
      fetchProjects();
    } catch (e: unknown) {
      alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function serviceAction(name: string, action: string) {
    await api.services.action(name, action);
    fetchProjects();
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Projects</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          + Add Project
        </button>
      </div>

      {/* Project list */}
      <div className="space-y-3">
        {loading ? (
          <div className="text-muted text-sm py-8 text-center">Loading…</div>
        ) : projects.length === 0 ? (
          <div className="text-muted text-sm py-8 text-center">
            No projects yet. Click <strong>+ Add Project</strong> to get started.
          </div>
        ) : (
          projects.map((p) => (
            <div key={p.name} className="bg-panel border border-border rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-white font-medium">{p.name}</div>
                  <div className="text-muted text-xs mt-0.5">{p.path}</div>
                  <div className="flex gap-2 mt-2">
                    {p.has_requirements && (
                      <span className="text-xs bg-blue-900/40 text-blue-400 border border-blue-800 px-2 py-0.5 rounded-full">
                        requirements.txt
                      </span>
                    )}
                    {p.has_service && (
                      <span className="text-xs bg-green-900/40 text-green-400 border border-green-800 px-2 py-0.5 rounded-full">
                        systemd service
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {p.has_service && (
                    <>
                      <button
                        onClick={() => serviceAction(p.name, "restart")}
                        className="text-xs px-2.5 py-1 rounded border border-yellow-800 text-yellow-400 hover:bg-yellow-900/30 transition-colors"
                      >
                        Restart
                      </button>
                      <button
                        onClick={() => serviceAction(p.name, "stop")}
                        className="text-xs px-2.5 py-1 rounded border border-red-800 text-red-400 hover:bg-red-900/30 transition-colors"
                      >
                        Stop
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => deleteProject(p.name, false)}
                    className="text-xs px-2.5 py-1 rounded border border-border text-muted hover:text-red-400 hover:border-red-800 transition-colors"
                  >
                    Remove Service
                  </button>
                  <button
                    onClick={() => deleteProject(p.name, true)}
                    className="text-xs px-2.5 py-1 rounded border border-red-900 text-red-500 hover:bg-red-900/30 transition-colors"
                  >
                    Delete All
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-panel border border-border rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h2 className="font-semibold text-white">Add Project</h2>
              <button onClick={resetAdd} className="text-muted hover:text-white text-xl leading-none">×</button>
            </div>

            {/* Steps */}
            <div className="flex gap-2 px-6 pt-4 shrink-0">
              {["upload", "configure", "deploying"].map((s, i) => (
                <div key={s} className="flex items-center gap-1.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    step === s ? "bg-blue-600 text-white" :
                    ["upload", "configure", "deploying"].indexOf(step) > i ? "bg-green-800 text-green-300" :
                    "bg-border text-muted"
                  }`}>
                    {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
                  </span>
                  {i < 2 && <span className="text-muted text-xs">→</span>}
                </div>
              ))}
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {error && (
                <div className="bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-lg px-4 py-3">
                  {error}
                </div>
              )}

              {/* Step 1: Upload */}
              {step === "upload" && (
                <>
                  <div>
                    <label className="block text-xs text-muted mb-1.5">Project Name <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value.replace(/\s/g, "-") })}
                      placeholder="mybot"
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-muted mt-1">Used as folder name and service name</p>
                  </div>

                  <div>
                    <label className="block text-xs text-muted mb-1.5">Upload Files <span className="text-red-400">*</span></label>
                    <div
                      onClick={() => fileRef.current?.click()}
                      className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-blue-500 transition-colors"
                    >
                      {file ? (
                        <div>
                          <div className="text-white text-sm font-medium">{file.name}</div>
                          <div className="text-muted text-xs mt-1">{(file.size / 1024).toFixed(1)} KB</div>
                        </div>
                      ) : (
                        <>
                          <div className="text-3xl mb-2">📦</div>
                          <div className="text-sm text-muted">
                            Click to upload a <strong className="text-white">.zip</strong> or <strong className="text-white">.py</strong> file
                          </div>
                          <div className="text-xs text-muted mt-1">Zip your entire project folder including requirements.txt</div>
                        </>
                      )}
                    </div>
                    <input ref={fileRef} type="file" accept=".zip,.py" className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </div>
                </>
              )}

              {/* Step 2: Configure */}
              {step === "configure" && (
                <>
                  <div className="bg-green-900/20 border border-green-800 rounded-lg px-4 py-3 text-sm text-green-400">
                    ✓ Files uploaded to server
                  </div>

                  <div>
                    <label className="block text-xs text-muted mb-1.5">Entry Point <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      value={form.python_file}
                      onChange={(e) => setForm({ ...form, python_file: e.target.value })}
                      placeholder="main.py"
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-muted mt-1">The Python file that starts your bot (e.g. bot.py, main.py)</p>
                  </div>

                  <div>
                    <label className="block text-xs text-muted mb-1.5">Description</label>
                    <input
                      type="text"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="My Telegram Bot"
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-muted mb-1.5">Environment Variables</label>
                    <textarea
                      value={form.env_vars}
                      onChange={(e) => setForm({ ...form, env_vars: e.target.value })}
                      placeholder={"BOT_TOKEN=123456:ABC-xyz\nAPI_KEY=mykey\nDEBUG=false"}
                      rows={4}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-blue-500 font-mono resize-none"
                    />
                    <p className="text-xs text-muted mt-1">One per line — KEY=VALUE format</p>
                  </div>
                </>
              )}

              {/* Step 3: Deploying - live log output */}
              {step === "deploying" && (
                <div
                  ref={logRef}
                  className="bg-surface rounded-xl p-4 font-mono text-xs h-72 overflow-y-auto space-y-0.5"
                >
                  {logs.length === 0 && (
                    <div className="text-muted">Connecting…</div>
                  )}
                  {logs.map((line, i) => (
                    <LogLine key={i} line={line} />
                  ))}
                  {working && (
                    <div className="text-muted animate-pulse">▊</div>
                  )}
                  {done && (
                    <div className="mt-3 text-green-400 font-bold">🎉 Deployment complete!</div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border flex justify-between items-center shrink-0">
              <button
                onClick={resetAdd}
                className="text-sm text-muted hover:text-white px-4 py-2 rounded-lg border border-border hover:border-gray-600 transition-colors"
              >
                {done ? "Close" : "Cancel"}
              </button>

              <div className="flex gap-2">
                {step === "upload" && (
                  <button
                    onClick={handleUpload}
                    disabled={working || !form.name || !file}
                    className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-5 py-2 rounded-lg transition-colors"
                  >
                    {working ? "Uploading…" : "Upload →"}
                  </button>
                )}

                {step === "configure" && (
                  <button
                    onClick={handleDeploy}
                    disabled={!form.python_file}
                    className="text-sm bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white px-5 py-2 rounded-lg transition-colors"
                  >
                    🚀 Install & Deploy
                  </button>
                )}

                {step === "deploying" && done && (
                  <button
                    onClick={resetAdd}
                    className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg transition-colors"
                  >
                    Done ✓
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
