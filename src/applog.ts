// アプリ内エラーログ。メモリ上のリングバッファに残し、設定画面からエクスポートできる。
// warn/error は diagnostics.log にも追記する（レンダラが死んでも死因が追える）。
// info は量が多いためメモリのみ。
import { invoke } from "@tauri-apps/api/core";
import { reportError } from "./telemetry";

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

function persist(level: "warn" | "error", tag: string, message: string) {
  try {
    void invoke("append_log", { level, tag, message: message.slice(0, 1000) }).catch(() => undefined);
  } catch { /* invoke自体が死んでいたら諦める（再帰防止） */ }
}

export const appLog = {
  info: (tag: string, message: string) => push("info", tag, message),
  warn: (tag: string, message: string) => { push("warn", tag, message); persist("warn", tag, message); },
  error: (tag: string, message: string) => { push("error", tag, message); persist("error", tag, message); reportError(tag, message); },
};

// レンダラの未捕捉例外をログに残す。Rootのマウント時に1度だけ呼ぶ。
export function installRendererErrorHook() {
  window.addEventListener("error", (event) => {
    appLog.error("renderer", `${event.message} @${event.filename}:${event.lineno}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
    appLog.error("renderer", `unhandledrejection: ${reason}`);
  });
}

export function getLogText() {
  return entries.map((entry) => `${entry.at} [${entry.level}] ${entry.tag}: ${entry.message}`).join("\n");
}
