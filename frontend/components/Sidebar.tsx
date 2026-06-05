"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/projects", label: "Projects", icon: "🚀" },
  { href: "/services", label: "Services", icon: "⚙" },
  { href: "/files", label: "Files", icon: "📁" },
  { href: "/terminal", label: "Terminal", icon: ">" },
  { href: "/logs", label: "Logs", icon: "≡" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 bg-panel border-r border-border flex flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-border">
        <div className="font-bold text-white text-lg leading-none">PyServer</div>
        <div className="text-muted text-xs mt-0.5">Manager</div>
      </div>

      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {NAV.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-blue-600/20 text-blue-400 font-medium"
                  : "text-muted hover:text-white hover:bg-white/5"
              }`}
            >
              <span className="w-4 text-center font-mono text-xs">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-2 pb-4">
        <button
          onClick={() => api.logout()}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted hover:text-red-400 hover:bg-red-900/10 transition-colors"
        >
          <span className="w-4 text-center text-xs">↩</span>
          Logout
        </button>
      </div>
    </aside>
  );
}
