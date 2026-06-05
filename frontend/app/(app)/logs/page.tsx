"use client";

import { useEffect, useRef, useState } from "react";
import { wsUrl } from "@/lib/api";

export default function LogsPage() {
  const [serviceName, setServiceName] = useState("");
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  function connect(name: string) {
    wsRef.current?.close();
    setLines([]);
    setServiceName(name);
    setConnected(false);

    const ws = new WebSocket(wsUrl("/api/ws/logs", { service: name, lines: "300" }));
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onmessage = (e) => {
      setLines((prev) => [...prev.slice(-2000), e.data as string]);
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
  }

  useEffect(() => {
    if (autoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines]);

  useEffect(() => () => wsRef.current?.close(), []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input.trim()) connect(input.trim());
  }

  function colorLine(line: string): string {
    if (/error|fail|critical/i.test(line)) return "text-red-400";
    if (/warn/i.test(line)) return "text-yellow-400";
    if (/info/i.test(line)) return "text-blue-400";
    if (/debug/i.test(line)) return "text-gray-500";
    return "text-gray-300";
  }

  return (
    <div className="flex flex-col h-screen p-6 gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-white">Logs</h1>
        {connected && (
          <span className="flex items-center gap-1.5 text-xs text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Live — {serviceName}
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Service name (e.g. mybot)"
          className="flex-1 max-w-sm bg-panel border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-blue-500 transition-colors"
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          Follow
        </button>
        {connected && (
          <button
            type="button"
            onClick={() => wsRef.current?.close()}
            className="text-sm text-red-400 hover:text-red-300 px-3 py-2 rounded-lg border border-red-800 hover:border-red-700 transition-colors"
          >
            Stop
          </button>
        )}
      </form>

      <div
        className="flex-1 bg-panel border border-border rounded-xl overflow-y-auto font-mono text-xs p-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {lines.length === 0 ? (
          <div className="text-muted text-center py-12">
            {serviceName ? "Waiting for logs…" : "Enter a service name above to start tailing logs"}
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`leading-5 whitespace-pre-wrap break-all ${colorLine(line)}`}>
              {line}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
