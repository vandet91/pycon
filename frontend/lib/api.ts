import Cookies from "js-cookie";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Auth helpers ──────────────────────────────────────────────

export function getToken(): string | undefined {
  return Cookies.get("psm_token");
}

function setToken(token: string) {
  Cookies.set("psm_token", token, { expires: 1, sameSite: "strict" });
}

export function removeToken() {
  Cookies.remove("psm_token");
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

// ── Base fetch ────────────────────────────────────────────────

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (res.status === 401) {
    removeToken();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    let detail = body;
    try {
      detail = JSON.parse(body)?.detail ?? body;
    } catch {}
    throw new Error(detail);
  }

  return res.json() as Promise<T>;
}

// ── WebSocket URL ─────────────────────────────────────────────

export function wsUrl(path: string, params: Record<string, string> = {}): string {
  const token = getToken() ?? "";
  const base = API_BASE.replace(/^http/, "ws");
  const qs = new URLSearchParams({ token, ...params }).toString();
  return `${base}${path}?${qs}`;
}

// ── API surface ───────────────────────────────────────────────

export interface Service {
  name: string;
  load: string;
  active: string;
  sub: string;
  description: string;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
}

export const api = {
  async login(username: string, password: string): Promise<void> {
    const body = new URLSearchParams({ username, password });
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      body,
    });
    if (!res.ok) throw new Error("Invalid credentials");
    const data = await res.json();
    setToken(data.access_token);
  },

  logout() {
    removeToken();
    if (typeof window !== "undefined") window.location.href = "/login";
  },

  services: {
    list: (search?: string) =>
      req<Service[]>(`/api/services${search ? `?search=${encodeURIComponent(search)}` : ""}`),
    status: (name: string) =>
      req<{ output: string; returncode: number }>(`/api/services/${name}/status`),
    action: (name: string, action: string) =>
      req<{ success: boolean; output: string }>(`/api/services/${name}/${action}`, {
        method: "POST",
      }),
  },

  files: {
    list: (path = "/") =>
      req<FileNode[]>(`/api/files/list?path=${encodeURIComponent(path)}`),
    read: (path: string) =>
      req<{ path: string; content: string }>(`/api/files/read?path=${encodeURIComponent(path)}`),
    save: (path: string, content: string) =>
      req<{ success: boolean }>(`/api/files/save`, {
        method: "POST",
        body: JSON.stringify({ path, content }),
      }),
    mkdir: (path: string) =>
      req<{ success: boolean }>(`/api/files/mkdir?path=${encodeURIComponent(path)}`, {
        method: "POST",
      }),
    delete: (path: string) =>
      req<{ success: boolean }>(`/api/files/delete?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
      }),
  },
};
