"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { api, type FileNode } from "@/lib/api";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

function FileTree({
  nodes,
  onSelect,
  selected,
  path,
  onNavigate,
  onDelete,
}: {
  nodes: FileNode[];
  onSelect: (node: FileNode) => void;
  selected: string;
  path: string;
  onNavigate: (path: string) => void;
  onDelete: (node: FileNode) => void;
}) {
  return (
    <div className="text-sm">
      {path !== "/" && (
        <button
          onClick={() => onNavigate(path.split("/").slice(0, -1).join("/") || "/")}
          className="flex items-center gap-2 px-3 py-1.5 text-muted hover:text-white w-full text-left hover:bg-white/5 rounded"
        >
          <span className="text-xs">←</span> ..
        </button>
      )}
      {nodes.map((node) => (
        <div
          key={node.path}
          className={`group flex items-center gap-2 px-3 py-1.5 rounded transition-colors ${
            selected === node.path
              ? "bg-blue-600/20 text-blue-300"
              : "text-gray-300 hover:text-white hover:bg-white/5"
          }`}
        >
          <button
            onClick={() => (node.is_dir ? onNavigate(node.path) : onSelect(node))}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
          >
            <span className="text-xs shrink-0">{node.is_dir ? "📁" : "📄"}</span>
            <span className="truncate text-xs font-mono">{node.name}</span>
            {!node.is_dir && node.size != null && (
              <span className="ml-auto text-muted text-xs shrink-0 pr-1">
                {node.size < 1024 ? `${node.size}B` : `${(node.size / 1024).toFixed(1)}K`}
              </span>
            )}
          </button>
          <button
            onClick={() => onDelete(node)}
            className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 text-xs px-1 shrink-0 transition-opacity"
            title={`Delete ${node.name}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    py: "python", ts: "typescript", tsx: "typescript", js: "javascript",
    jsx: "javascript", json: "json", md: "markdown", sh: "shell",
    yaml: "yaml", yml: "yaml", toml: "toml", txt: "plaintext",
    env: "plaintext", cfg: "ini", ini: "ini",
  };
  return map[ext] ?? "plaintext";
}

export default function FilesPage() {
  const [dirPath, setDirPath] = useState("/");
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [selected, setSelected] = useState<FileNode | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await api.files.list(path);
      setNodes(data);
      setDirPath(path);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDir("/"); }, [loadDir]);

  async function openFile(node: FileNode) {
    setSelected(node);
    setError("");
    try {
      const data = await api.files.read(node.path);
      setContent(data.content);
      setSavedContent(data.content);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveFile() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      await api.files.save(selected.path, content);
      setSavedContent(content);
      setStatus("Saved ✓");
      setTimeout(() => setStatus(""), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function newFile() {
    const name = prompt("File name (relative to current directory):");
    if (!name) return;
    const path = `${dirPath === "/" ? "" : dirPath}/${name}`;
    await api.files.save(path, "");
    await loadDir(dirPath);
  }

  async function newFolder() {
    const name = prompt("Folder name:");
    if (!name) return;
    const path = `${dirPath === "/" ? "" : dirPath}/${name}`;
    await api.files.mkdir(path);
    await loadDir(dirPath);
  }

  async function deleteSelected() {
    if (!selected) return;
    if (!confirm(`Delete ${selected.name}?`)) return;
    await api.files.delete(selected.path);
    setSelected(null);
    setContent("");
    await loadDir(dirPath);
  }

  async function deleteNode(node: FileNode) {
    const label = node.is_dir ? `folder "${node.name}" and all its contents` : `"${node.name}"`;
    if (!confirm(`Delete ${label}?`)) return;
    try {
      await api.files.delete(node.path);
      if (selected?.path === node.path || selected?.path.startsWith(node.path + "/")) {
        setSelected(null);
        setContent("");
      }
      await loadDir(dirPath);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const isDirty = content !== savedContent;

  return (
    <div className="flex h-screen">
      {/* File tree */}
      <div className="w-60 shrink-0 border-r border-border bg-panel flex flex-col">
        <div className="px-3 py-2.5 border-b border-border flex items-center gap-1.5">
          <span className="text-xs text-muted font-mono truncate flex-1">{dirPath}</span>
          <button onClick={newFile} title="New file" className="text-muted hover:text-white text-xs px-1">+📄</button>
          <button onClick={newFolder} title="New folder" className="text-muted hover:text-white text-xs px-1">+📁</button>
          <button onClick={() => loadDir(dirPath)} title="Refresh" className="text-muted hover:text-white text-xs px-1">↻</button>
        </div>
        <div className="flex-1 overflow-y-auto py-1 px-1">
          {loading ? (
            <div className="px-3 py-4 text-muted text-xs">Loading…</div>
          ) : (
            <FileTree
              nodes={nodes}
              onSelect={openFile}
              selected={selected?.path ?? ""}
              path={dirPath}
              onNavigate={loadDir}
              onDelete={deleteNode}
            />
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {selected ? (
          <>
            <div className="h-10 bg-panel border-b border-border flex items-center px-4 gap-3 shrink-0">
              <span className="text-xs font-mono text-muted truncate flex-1">{selected.path}</span>
              {isDirty && <span className="text-xs text-yellow-500">● unsaved</span>}
              {status && <span className="text-xs text-green-400">{status}</span>}
              {error && <span className="text-xs text-red-400 truncate max-w-xs">{error}</span>}
              <button
                onClick={deleteSelected}
                className="text-xs text-red-500 hover:text-red-400 ml-2"
              >
                Delete
              </button>
              <button
                onClick={saveFile}
                disabled={saving || !isDirty}
                className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-3 py-1 rounded transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
            <div className="flex-1">
              <MonacoEditor
                height="100%"
                language={langFromPath(selected.path)}
                theme="vs-dark"
                value={content}
                onChange={(v) => setContent(v ?? "")}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  tabSize: 4,
                }}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted text-sm">
            Select a file to edit
          </div>
        )}
      </div>
    </div>
  );
}
