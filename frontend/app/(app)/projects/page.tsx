"use client";

import { useEffect, useRef, useState } from "react";
import { api, getToken } from "@/lib/api";

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

const defaultForm: DeployForm = {
  name: "",
  description: "",
  python_file: "main.py",
  env_vars: "",
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<DeployForm>(defaultForm);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"upload" | "deploy">("upload");
  const [log, setLog] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function fetchProjects() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/projects/list`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setProjects(data);
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
    setLog("");
    setError("");
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
      if (!res.ok) throw new Error((await res.json()).detail);
      setStep("deploy");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  async function handleDeploy() {
    setWorking(true);
    setError("");
    setLog("");
    try {
      const res = await fetch(`${API_BASE}/api/projects/deploy`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      setLog(data.log || "");
      if (!res.ok) throw new Error(data.detail || "Deploy failed");
      await fetchProjects();
      setTimeout(resetAdd, 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
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
                <div className="flex gap-2 shrink-0">
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
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add project modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-panel border border-border rounded-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="font-semibold text-white">Add Project</h2>
              <button onClick={resetAdd} className="text-muted hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Step indicator */}
              <div className="flex gap-2 text-xs mb-2">
                <span className={`px-2 py-0.5 rounded-full ${step === "upload" ? "bg-blue-600 text-white" : "bg-border text-muted"}`}>
                  1. Upload
                </span>
                <span className={`px-2 py-0.5 rounded-full ${step === "deploy" ? "bg-blue-600 text-white" : "bg-border text-muted"}`}>
                  2. Configure & Deploy
                </span>
              </div>

              {error && (
                <div className="bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-lg px-4 py-3">
                  {error}
                </div>
              )}

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
                    <p className="text-xs text-muted mt-1">Used as the folder name and service name</p>
                  </div>

                  <div>
                    <label className="block text-xs text-muted mb-1.5">Upload Files <span className="text-red-400">*</span></label>
                    <div
                      onClick={() => fileRef.current?.click()}
                      className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-blue-500 transition-colors"
                    >
                      {file ? (
                        <div className="text-sm text-white">{file.name}</div>
                      ) : (
                        <>
                          <div className="text-2xl mb-2">📦</div>
                          <div className="text-sm text-muted">Click to upload a <strong>.zip</strong> file or single <strong>.py</strong> file</div>
                        </>
                      )}
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".zip,.py"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                </>
              )}

              {step === "deploy" && (
                <>
                  <div>
                    <label className="block text-xs text-muted mb-1.5">Description</label>
                    <input
                      type="text"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="My Telegram bot"
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-blue-500"
                    />
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
                    <p className="text-xs text-muted mt-1">The Python file to run (e.g. bot.py, main.py)</p>
                  </div>

                  <div>
                    <label className="block text-xs text-muted mb-1.5">Environment Variables</label>
                    <textarea
                      value={form.env_vars}
                      onChange={(e) => setForm({ ...form, env_vars: e.target.value })}
                      placeholder={"BOT_TOKEN=123456:ABC\nAPI_KEY=mykey"}
                      rows={4}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-blue-500 font-mono resize-none"
                    />
                    <p className="text-xs text-muted mt-1">One per line, KEY=VALUE format</p>
                  </div>

                  {log && (
                    <pre className="bg-surface rounded-lg p-3 text-xs font-mono text-gray-300 overflow-auto max-h-48 whitespace-pre-wrap">
                      {log}
                    </pre>
                  )}
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
              <button
                onClick={resetAdd}
                className="text-sm text-muted hover:text-white px-4 py-2 rounded-lg border border-border hover:border-gray-600 transition-colors"
              >
                Cancel
              </button>

              {step === "upload" && (
                <button
                  onClick={handleUpload}
                  disabled={working || !form.name || !file}
                  className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-5 py-2 rounded-lg transition-colors"
                >
                  {working ? "Uploading…" : "Upload →"}
                </button>
              )}

              {step === "deploy" && (
                <button
                  onClick={handleDeploy}
                  disabled={working || !form.python_file}
                  className="text-sm bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white px-5 py-2 rounded-lg transition-colors"
                >
                  {working ? "Deploying…" : "🚀 Install & Start"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
