"use client";

import { useEffect, useState, useCallback } from "react";
import { api, type Service } from "@/lib/api";

function StatusBadge({ active, sub }: { active: string; sub: string }) {
  const running = active === "active" && sub === "running";
  const failed = active === "failed" || sub === "failed";
  const color = running
    ? "bg-green-900/40 text-green-400 border-green-800"
    : failed
    ? "bg-red-900/40 text-red-400 border-red-800"
    : "bg-gray-800 text-gray-400 border-gray-700";
  const dot = running ? "bg-green-400" : failed ? "bg-red-400" : "bg-gray-500";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot} ${running ? "animate-pulse" : ""}`} />
      {sub || active}
    </span>
  );
}

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusOutput, setStatusOutput] = useState<{ name: string; output: string } | null>(null);
  const [error, setError] = useState("");

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.services.list(search || undefined);
      setServices(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(fetchServices, 300);
    return () => clearTimeout(t);
  }, [fetchServices]);

  async function doAction(name: string, action: string) {
    setActionLoading(`${name}:${action}`);
    setError("");
    try {
      await api.services.action(name, action);
      await fetchServices();
    } catch (e: unknown) {
      setError(`${action} ${name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActionLoading(null);
    }
  }

  async function showStatus(name: string) {
    if (statusOutput?.name === name) {
      setStatusOutput(null);
      return;
    }
    const data = await api.services.status(name);
    setStatusOutput({ name, output: data.output });
  }

  const btn = (label: string, action: string, name: string, color: string) => {
    const key = `${name}:${action}`;
    return (
      <button
        key={action}
        onClick={() => doAction(name, action)}
        disabled={actionLoading === key}
        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40 ${color}`}
      >
        {actionLoading === key ? "…" : label}
      </button>
    );
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Services</h1>
        <button
          onClick={fetchServices}
          className="text-xs text-muted hover:text-white px-3 py-1.5 rounded border border-border hover:border-gray-600 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search services…"
        className="w-full max-w-sm bg-panel border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-blue-500 mb-5 transition-colors"
      />

      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      <div className="bg-panel border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-muted text-sm">Loading services…</div>
        ) : services.length === 0 ? (
          <div className="py-16 text-center text-muted text-sm">No services found</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-xs border-b border-border">
                  <th className="text-left px-5 py-3 font-medium">Name</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Description</th>
                  <th className="text-right px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <>
                    <tr
                      key={s.name}
                      className="border-b border-border/50 hover:bg-white/2 transition-colors"
                    >
                      <td className="px-5 py-3">
                        <button
                          onClick={() => showStatus(s.name)}
                          className="font-mono text-xs text-blue-400 hover:text-blue-300 text-left"
                        >
                          {s.name}
                        </button>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge active={s.active} sub={s.sub} />
                      </td>
                      <td className="px-5 py-3 text-muted text-xs hidden md:table-cell truncate max-w-xs">
                        {s.description}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-1.5 justify-end">
                          {btn("Start", "start", s.name, "bg-green-900/40 text-green-400 hover:bg-green-800/40 border border-green-800")}
                          {btn("Stop", "stop", s.name, "bg-red-900/40 text-red-400 hover:bg-red-800/40 border border-red-800")}
                          {btn("Restart", "restart", s.name, "bg-yellow-900/40 text-yellow-400 hover:bg-yellow-800/40 border border-yellow-800")}
                        </div>
                      </td>
                    </tr>
                    {statusOutput?.name === s.name && (
                      <tr key={`${s.name}-status`} className="border-b border-border/50">
                        <td colSpan={4} className="px-5 py-3">
                          <pre className="bg-surface rounded-lg p-4 text-xs font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-64">
                            {statusOutput.output}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
