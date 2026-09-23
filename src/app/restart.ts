import { relaunch } from "@tauri-apps/plugin-process";
import { appLog } from "../applog";
import { trackEvent } from "../telemetry";

// speech-bridge.ts が投げる致命的な文言。子プロセスの復旧では直らず、
// アプリ再起動が一番確実なものだけを対象にする。
const FATAL_FRAGMENTS = [
  "音声認識ブリッジから応答がありません",
  "音声認識ブリッジが終了しました",
  "音声認識ブリッジの起動がタイムアウトしました",
];

export function isBridgeFatalError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return FATAL_FRAGMENTS.some((fragment) => message.includes(fragment));
}

let restartRequested = false;

export function isRestartPending(): boolean {
  return restartRequested;
}

const RESTART_COUNT_KEY = "voicelatte.restartCount";
const RESTART_WINDOW_MS = 5 * 60 * 1000;
const MAX_RESTARTS_PER_WINDOW = 3;

// 再起動ループ防止。短期間に繰り返し落ちる場合は再起動せずエラーのままにする。
function restartAllowed(): boolean {
  try {
    const raw = localStorage.getItem(RESTART_COUNT_KEY);
    const now = Date.now();
    if (!raw) {
      localStorage.setItem(RESTART_COUNT_KEY, JSON.stringify({ count: 1, firstAt: now }));
      return true;
    }
    const record = JSON.parse(raw) as { count: number; firstAt: number };
    if (now - record.firstAt > RESTART_WINDOW_MS) {
      localStorage.setItem(RESTART_COUNT_KEY, JSON.stringify({ count: 1, firstAt: now }));
      return true;
    }
    if (record.count >= MAX_RESTARTS_PER_WINDOW) return false;
    localStorage.setItem(RESTART_COUNT_KEY, JSON.stringify({ count: record.count + 1, firstAt: record.firstAt }));
    return true;
  } catch {
    return true;
  }
}

export function requestAppRestart(reason: string, delayMs = 1500): void {
  if (restartRequested) return;
  if (!restartAllowed()) {
    appLog.error("restart", `restart suppressed (loop guard): ${reason}`);
    trackEvent("app_restart_suppressed", { reason });
    return;
  }
  restartRequested = true;
  appLog.error("restart", `requesting app restart: ${reason}`);
  trackEvent("app_restart", { reason });
  window.setTimeout(() => {
    void relaunch().catch((error) => {
      restartRequested = false;
      appLog.error("restart", `relaunch failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, delayMs);
}
