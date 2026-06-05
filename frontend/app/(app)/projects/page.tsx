"use client";

import { useEffect, useRef, useState } from "react";
import { api, getToken, wsUrl } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Project {
  name: string;
  path: string;
  has_service: boolean;
  has_requirements: boolean;
  active: string;
  enabled: string;
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

function StatusBadge({ active }: { active: string }) {
  const map: Record<string, { color: string; dot: string; label: string; pulse: boolean }> = {
    active:     { color: "bg-green-900/40 text-green-400 border-green-800",  dot: "bg-green-400",  label: "Running",  pulse: true  },
    inactive:   { color: "bg-gray-800 text-gray-400 border-gray-700",        dot: "bg-gray-500",   label: "Stopped",  pulse: false },
    failed:     { color: "bg-red-900/40 text-red-400 border-red-800",        dot: "bg-red-400",    label: "Failed",   pulse: false },
    activating: { color: "bg-yellow-900/40 text-yellow-400 border-yellow-800", dot: "bg-yellow-400", label: "Starting", pulse: true  },
    none:       { color: "bg-gray-800 text-gray-500 border-gray-700",        dot: "bg-gray-600",   label: "No Service", pulse: false },
  };
  const s = map[active] ?? map["none"];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${s.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${s.pulse ? "animate-pulse" : ""}`} />
      {s.label}
    </span>
  );
}

function LogOutput({ lines, working, done }: { lines: LogLine[]; working: boolean; done: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [lines]);

  const color = (type: string) =>
    type === "error" ? "text-red-400" :
    type === "success" ? "text-green-400" :
    type === "step" ? "text-blue-300 font-semibold mt-1" :
    type === "warn" ? "text-yellow-400" :
    "text-gray-300";

  return (
    <div ref={ref} className="bg-surface rounded-xl p-4 font-mono text-xs h-56 overflow-y-auto space-y-0.5">
      {lines.length === 0 && <div className="text-muted">Connecting…</div>}
      {lines.map((l, i) => (
        <div key={i} className={color(l.type)}>{l.msg}</div>
      ))}
      {working && <div className="text-muted animate-pulse">▊</div>}
      {done && <div className="mt-2 text-green-400 font-bold">✅ Done!</div>}
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<DeployForm>(defaultForm);
  const [file, setFile] = useState<File | null>(null);
  const [entryCandidates, setEntryCandidates] = useState<string[]>([]);

  // step: upload → installing → configure → deploying → done
  const [step, setStep] = useState<"upload" | "installing" | "configure" | "deploying" | "done">("upload");
  const [installLogs, setInstallLogs] = useState<LogLine[]>([]);
  const [deployLogs, setDeployLogs] = useState<LogLine[]>([]);
  const [working, setWorking] = useState(false);
  const [installDone, setInstallDone] = useState(false);
  const [deployDone, setDeployDone] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

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

  function resetAdd() {
    setShowAdd(false);
    setForm(defaultForm);
    setFile(null);
    setStep("upload");
    setInstallLogs([]);
    setDeployLogs([]);
    setWorking(false);
    setInstallDone(false);
    setDeployDone(false);
    setError("");
    setEntryCandidates([]);
  }

  function runWs(
    url: string,
    setLogs: (fn: (p: LogLine[]) => LogLine[]) => void,
    onDone: () => void
  ) {
    const ws = new WebSocket(url);
    ws.onmessage = (e) => {
      try {
        const data: LogLine = JSON.parse(e.data);
        if (data.type === "done") { onDone(); }
        else { setLogs((prev) => [...prev, data]); }
      } catch {
        setLogs((prev) => [...prev, { type: "log", msg: e.data }]);
      }
    };
    ws.onerror = () => {
      setLogs((prev) => [...prev, { type: "error", msg: "Connection error" }]);
      setWorking(false);
    };
    return ws;
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
      const data = await res.json();

      // Set detected entry point
      if (data.entry_candidates?.length > 0) {
        setForm((f) => ({ ...f, python_file: data.entry_candidates[0] }));
        setEntryCandidates(data.entry_candidates);
      }

      // Auto-install requirements if found
      if (data.has_requirements) {
        setStep("installing");
        setWorking(true);
        const url = wsUrl(`/api/projects/ws/install`) + `&name=${encodeURIComponent(form.name)}`;
        runWs(
          url,
          (fn) => setInstallLogs(fn),
          () => {
            setInstallDone(true);
            setWorking(false);
            setStep("configure");
          }
        );
      } else {
        setWorking(false);
        setStep("configure");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setWorking(false);
    }
  }

  async function handleDeploy() {
    setStep("deploying");
    setDeployLogs([]);
    setDeployDone(false);
    setWorking(true);

    const params = new URLSearchParams({
      name: form.name,
      python_file: form.python_file,
      description: form.description,
      env_vars: form.env_vars,
    });

    const url = wsUrl(`/api/projects/ws/deploy`) + "&" + params.toString();
    runWs(
      url,
      (fn) => setDeployLogs(fn),
      () => {
        setDeployDone(true);
        setWorking(false);
        setStep("done");
        fetchProjects();
      }
    );
  }

  async function deleteProject(name: string, deleteFiles: boolean) {
    if (!confirm(`Remove "${name}"${deleteFiles ? " and delete all files" : ""}?`)) return;
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

  const stepIndex = ["upload", "installing", "configure", "deploying", "done"].indexOf(step);

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
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-mono text-white font-medium">{p.name}</div>
                    <StatusBadge active={p.active} />
                  </div>
                  <div className="text-muted text-xs mt-0.5">{p.path}</div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {p.has_requirements && (
                      <span className="text-xs bg-blue-900/40 text-blue-400 border border-blue-800 px-2 py-0.5 rounded-full">
                        requirements.txt
                      </span>
                    )}
                    {p.has_service && (
                      <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded-full">
                        {p.enabled === "enabled" ? "⚡ auto-start" : "manual"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {p.has_service && (
                    <>
                      {/* Show Start only when stopped or failed */}
                      {(p.active === "inactive" || p.active === "failed") && (
                        <button onClick={() => serviceAction(p.name, "start")}
                          className="text-xs px-2.5 py-1 rounded border border-green-800 text-green-400 hover:bg-green-900/30 transition-colors">
                          ▶ Start
                        </button>
                      )}
                      {p.active === "active" && (
                        <button onClick={() => serviceAction(p.name, "restart")}
                          className="text-xs px-2.5 py-1 rounded border border-yellow-800 text-yellow-400 hover:bg-yellow-900/30 transition-colors">
                          ↺ Restart
                        </button>
                      )}
                      {p.active === "active" && (
                        <button onClick={() => serviceAction(p.name, "stop")}
                          className="text-xs px-2.5 py-1 rounded border border-red-800 text-red-400 hover:bg-red-900/30 transition-colors">
                          ■ Stop
                        </button>
                      )}
                    </>
                  )}
                  <button onClick={() => deleteProject(p.name, false)}
                    className="text-xs px-2.5 py-1 rounded border border-border text-muted hover:text-red-400 hover:border-red-800 transition-colors">
                    Remove
                  </button>
                  <button onClick={() => deleteProject(p.name, true)}
                    className="text-xs px-2.5 py-1 rounded border border-red-900 text-red-500 hover:bg-red-900/30 transition-colors">
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
          <div className="bg-panel border border-border rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h2 className="font-semibold text-white">Add Project</h2>
              <button onClick={resetAdd} className="text-muted hover:text-white text-xl">×</button>
            </div>

            {/* Step bar */}
            <div className="flex gap-1.5 px-6 pt-4 shrink-0 text-xs overflow-x-auto pb-1">
              {[
                { key: "upload", label: "Upload" },
                { key: "installing", label: "Install Deps" },
                { key: "configure", label: "Configure" },
                { key: "deploying", label: "Deploy" },
              ].map(({ key, label }, i) => {
                const idx = ["upload", "installing", "configure", "deploying"].indexOf(key);
                const active = step === key || (key === "installing" && step === "configure" && installDone);
                const past = stepIndex > idx && step !== key;
                return (
                  <span key={key} className={`px-2.5 py-1 rounded-full whitespace-nowrap ${
                    active ? "bg-blue-600 text-white" :
                    past ? "bg-green-900/60 text-green-400" :
                    "bg-surface text-muted"
                  }`}>
                    {past ? "✓ " : ""}{label}
                  </span>
                );
              })}
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {error && (
                <div className="bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-lg px-4 py-3">
                  {error}
                </div>
              )}

              {/* Upload step */}
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
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1.5">Upload Files <span className="text-red-400">*</span></label>
                    <div onClick={() => fileRef.current?.click()}
                      className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-blue-500 transition-colors">
                      {file ? (
                        <div>
                          <div className="text-white text-sm font-medium">{file.name}</div>
                          <div className="text-muted text-xs mt-1">{(file.size / 1024).toFixed(1)} KB</div>
                        </div>
                      ) : (
                        <>
                          <div className="text-3xl mb-2">📦</div>
                          <div className="text-sm text-muted">
                            Upload a <strong className="text-white">.zip</strong> or single <strong className="text-white">.py</strong> file
                          </div>
                          <div className="text-xs text-muted mt-1">
                            requirements.txt will be auto-detected and installed
                          </div>
                        </>
                      )}
                    </div>
                    <input ref={fileRef} type="file" accept=".zip,.py" className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </div>
                </>
              )}

              {/* Installing step */}
              {(step === "installing" || (step === "configure" && installLogs.length > 0)) && (
                <div>
                  <div className="text-xs text-muted mb-2">
                    {step === "installing" ? "Installing requirements…" : "✓ Requirements installed"}
                  </div>
                  <LogOutput lines={installLogs} working={step === "installing"} done={installDone} />
                </div>
              )}

              {/* Configure step */}
              {(step === "configure" || step === "deploying" || step === "done") && (
                <>
                  <div>
                    <label className="block text-xs text-muted mb-1.5">Entry Point <span className="text-red-400">*</span></label>
                    {entryCandidates.length > 1 ? (
                      <select
                        value={form.python_file}
                        onChange={(e) => setForm({ ...form, python_file: e.target.value })}
                        className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      >
                        {entryCandidates.map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    ) : (
                      <input type="text" value={form.python_file}
                        onChange={(e) => setForm({ ...form, python_file: e.target.value })}
                        placeholder="main.py"
                        className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-blue-500"
                      />
                    )}
                    <p className="text-xs text-muted mt-1">The Python file that starts your bot</p>
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1.5">Description</label>
                    <input type="text" value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="My Telegram Bot"
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1.5">Environment Variables</label>
                    <textarea value={form.env_vars}
                      onChange={(e) => setForm({ ...form, env_vars: e.target.value })}
                      placeholder={"BOT_TOKEN=123456:ABC\nAPI_KEY=mykey"}
                      rows={3}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-blue-500 font-mono resize-none"
                    />
                  </div>
                </>
              )}

              {/* Deploy output */}
              {(step === "deploying" || step === "done") && (
                <LogOutput lines={deployLogs} working={step === "deploying"} done={deployDone} />
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border flex justify-between shrink-0">
              <button onClick={resetAdd}
                className="text-sm text-muted hover:text-white px-4 py-2 rounded-lg border border-border hover:border-gray-600 transition-colors">
                {step === "done" ? "Close" : "Cancel"}
              </button>

              {step === "upload" && (
                <button onClick={handleUpload} disabled={working || !form.name || !file}
                  className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-5 py-2 rounded-lg transition-colors">
                  {working ? "Uploading…" : "Upload →"}
                </button>
              )}

              {step === "installing" && (
                <div className="text-xs text-muted flex items-center gap-2">
                  <span className="animate-spin">⟳</span> Installing dependencies…
                </div>
              )}

              {step === "configure" && (
                <button onClick={handleDeploy} disabled={!form.python_file}
                  className="text-sm bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white px-5 py-2 rounded-lg transition-colors">
                  🚀 Create Service & Start
                </button>
              )}

              {step === "done" && (
                <button onClick={resetAdd}
                  className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg transition-colors">
                  Done ✓
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
