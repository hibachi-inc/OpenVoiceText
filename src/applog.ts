// アプリ内エラーログ。メモリ上のリングバッファに残し、設定画面からエクスポートできる。
export type LogEntry = { at: string; level: "info" | "warn" | "error"; tag: string; message: string };

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
const listeners = new Set<() => void>();

export function subscribeLog(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function push(level: LogEntry["level"], tag: string, message: string) {
  entries.push({ at: new Date().toISOString(), level, tag, message: message.slice(0, 1000) });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  listeners.forEach((listener) => listener());
}

export const appLog = {
  info: (tag: string, message: string) => push("info", tag, message),
  warn: (tag: string, message: string) => push("warn", tag, message),
  error: (tag: string, message: string) => push("error", tag, message),
};

export function getLogText() {
  return entries.map((entry) => `${entry.at} [${entry.level}] ${entry.tag}: ${entry.message}`).join("\n");
}

export function downloadLog() {
  const blob = new Blob([getLogText() || "(empty)\n"], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `voicelatte-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
