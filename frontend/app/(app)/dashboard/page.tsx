"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

export default function DashboardPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.services
      .list()
      .then(setServices)
      .finally(() => setLoading(false));
  }, []);

  const running = services.filter((s) => s.sub === "running").length;
  const failed = services.filter((s) => s.active === "failed" || s.sub === "failed").length;
  const total = services.length;

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-xl font-semibold text-white mb-6">Dashboard</h1>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total Services", value: total, color: "text-white" },
          { label: "Running", value: running, color: "text-green-400" },
          { label: "Failed", value: failed, color: "text-red-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-panel border border-border rounded-xl p-5">
            <div className="text-muted text-xs mb-1">{label}</div>
            <div className={`text-3xl font-bold ${color}`}>
              {loading ? "—" : value}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-panel border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-medium text-white">All Services</span>
          <Link href="/services" className="text-xs text-blue-400 hover:text-blue-300">
            Manage →
          </Link>
        </div>
        {loading ? (
          <div className="px-5 py-8 text-center text-muted text-sm">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-xs border-b border-border">
                <th className="text-left px-5 py-2.5 font-medium">Name</th>
                <th className="text-left px-5 py-2.5 font-medium">Status</th>
                <th className="text-left px-5 py-2.5 font-medium hidden lg:table-cell">Description</th>
              </tr>
            </thead>
            <tbody>
              {services.slice(0, 20).map((s) => (
                <tr key={s.name} className="border-b border-border/50 hover:bg-white/2 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-white">{s.name}</td>
                  <td className="px-5 py-3">
                    <StatusBadge active={s.active} sub={s.sub} />
                  </td>
                  <td className="px-5 py-3 text-muted text-xs hidden lg:table-cell truncate max-w-xs">
                    {s.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
