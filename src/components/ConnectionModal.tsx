import { useState } from "react";
import { X, Loader, Wifi, Lock, Database } from "lucide-react";
import type { RedisConnection } from "../types";

interface ConnectionModalProps {
  onClose: () => void;
  onAdd: (conn: Omit<RedisConnection, "id" | "status">) => void;
}

const COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444",
  "#a855f7", "#ec4899", "#06b6d4", "#f97316",
];

export function ConnectionModal({ onClose, onAdd }: ConnectionModalProps) {
  const [form, setForm] = useState({
    name: "",
    host: "127.0.0.1",
    port: "6379",
    password: "",
    db: "0",
    tls: false,
    color: COLORS[0],
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "error" | null>(null);

  const update = (field: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleTest = () => {
    setTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      setTestResult("ok");
    }, 1200);
  };

  const handleSave = () => {
    onAdd({
      name: form.name || `${form.host}:${form.port}`,
      host: form.host,
      port: Number(form.port),
      password: form.password || undefined,
      db: Number(form.db),
      tls: form.tls,
      color: form.color,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-base-200 rounded-2xl w-full max-w-md mx-4 shadow-2xl border border-base-content/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-content/10">
          <h2 className="text-sm font-semibold font-mono">New Connection</h2>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-xs btn-circle cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Color + Name row */}
          <div className="flex gap-3 items-end">
            <div className="shrink-0">
              <label className="text-[10px] font-mono text-base-content/50 uppercase tracking-wider mb-1.5 block">
                Color
              </label>
              <div className="flex gap-1.5 flex-wrap w-20">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => update("color", c)}
                    className={`w-5 h-5 rounded-full cursor-pointer transition-transform duration-150 ${
                      form.color === c ? "scale-125 ring-2 ring-offset-2 ring-offset-base-200 ring-white/30" : "hover:scale-110"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="text-[10px] font-mono text-base-content/50 uppercase tracking-wider mb-1.5 block">
                Name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="My Redis Server"
                className="input input-sm w-full bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
              />
            </div>
          </div>

          {/* Host + Port */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] font-mono text-base-content/50 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Wifi size={9} /> Host
              </label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => update("host", e.target.value)}
                className="input input-sm w-full bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
              />
            </div>
            <div className="w-24">
              <label className="text-[10px] font-mono text-base-content/50 uppercase tracking-wider mb-1.5 block">
                Port
              </label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => update("port", e.target.value)}
                className="input input-sm w-full bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="text-[10px] font-mono text-base-content/50 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Lock size={9} /> Password
            </label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              placeholder="Optional"
              className="input input-sm w-full bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
            />
          </div>

          {/* DB + TLS row */}
          <div className="flex gap-3 items-end">
            <div className="w-24">
              <label className="text-[10px] font-mono text-base-content/50 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Database size={9} /> Database
              </label>
              <input
                type="number"
                min="0"
                max="15"
                value={form.db}
                onChange={(e) => update("db", e.target.value)}
                className="input input-sm w-full bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
              />
            </div>
            <div className="flex-1">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.tls}
                  onChange={(e) => update("tls", e.target.checked)}
                  className="toggle toggle-sm toggle-success cursor-pointer"
                />
                <span className="text-xs font-mono text-base-content/70">
                  TLS / SSL
                </span>
              </label>
            </div>
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono ${
                testResult === "ok"
                  ? "bg-success/10 text-success"
                  : "bg-error/10 text-error"
              }`}
            >
              <Wifi size={12} />
              {testResult === "ok"
                ? "Connection successful!"
                : "Connection failed. Check your settings."}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 py-4 border-t border-base-content/10">
          <button
            onClick={handleTest}
            disabled={testing}
            className="btn btn-ghost btn-sm flex-1 cursor-pointer font-mono"
          >
            {testing ? (
              <Loader size={13} className="animate-spin" />
            ) : (
              "Test Connection"
            )}
          </button>
          <button onClick={onClose} className="btn btn-ghost btn-sm cursor-pointer font-mono">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn btn-success btn-sm cursor-pointer font-mono"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
