"use client";

import { useEffect, useState } from "react";

interface User {
  id: string;
  username: string;
  role: string;
  created_at?: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
    setUsers([]);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-white mb-6">Users</h1>
      {error && <p className="text-red-400 mb-4">{error}</p>}
      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-gray-400">No users found.</p>
      ) : (
        <table className="w-full text-sm text-left text-gray-300">
          <thead className="text-xs text-gray-400 uppercase bg-gray-800">
            <tr>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-gray-700 hover:bg-gray-800">
                <td className="px-4 py-3">{u.username}</td>
                <td className="px-4 py-3">{u.role}</td>
                <td className="px-4 py-3">{u.created_at ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
