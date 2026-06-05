"use client";

import { useEffect, useRef } from "react";
import { wsUrl } from "@/lib/api";

export default function TerminalPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (!containerRef.current || initialized.current) return;
    initialized.current = true;

    let term: import("xterm").Terminal;
    let fitAddon: import("xterm-addon-fit").FitAddon;
    let ws: WebSocket;
    let resizeObserver: ResizeObserver;

    (async () => {
      const { Terminal } = await import("xterm");
      const { FitAddon } = await import("xterm-addon-fit");
      const { WebLinksAddon } = await import("xterm-addon-web-links");

      term = new Terminal({
        theme: {
          background: "#0d1117",
          foreground: "#e6edf3",
          cursor: "#58a6ff",
          selectionBackground: "#264f78",
        },
        fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
        fontSize: 14,
        lineHeight: 1.4,
        cursorBlink: true,
        scrollback: 5000,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      term.open(containerRef.current!);
      fitAddon.fit();

      ws = new WebSocket(wsUrl("/api/ws/terminal"));
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        term.write("\x1b[32mConnected to server\x1b[0m\r\n");
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(e.data));
        } else {
          term.write(e.data as string);
        }
      };

      ws.onerror = () => term.write("\r\n\x1b[31mWebSocket error\x1b[0m\r\n");
      ws.onclose = () => term.write("\r\n\x1b[33mConnection closed\x1b[0m\r\n");

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });

      resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      });
      resizeObserver.observe(containerRef.current!);
    })();

    return () => {
      ws?.close();
      term?.dispose();
      resizeObserver?.disconnect();
      initialized.current = false;
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-surface p-0">
      <div className="bg-panel border-b border-border px-5 py-2.5 flex items-center gap-2 shrink-0">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500" />
          <span className="w-3 h-3 rounded-full bg-yellow-500" />
          <span className="w-3 h-3 rounded-full bg-green-500" />
        </div>
        <span className="text-xs text-muted ml-2">bash — server terminal</span>
      </div>
      <div ref={containerRef} className="flex-1 p-2 overflow-hidden" />
    </div>
  );
}
