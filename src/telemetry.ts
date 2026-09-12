// 匿名エラー収集（既定オフ）。PostHog＝失敗系イベント、Sentry＝例外。
// 音声・画面・キー本文は送らない。自動キャプチャ・リプレイは使わない。
// PostHogはSDKを使わず直接POSTする（Tauri webviewでのSDK不具合を避けるため）。
// Sentry SDKは同意オンのときだけ動的 import する（通常バンドルを太らせない）。
import { invoke } from "@tauri-apps/api/core";

const POSTHOG_KEY = "phc_mo975FUwpLfM2p3f8cSG9DEcLCG99eLTR5Fc8idJ3hYc";
const POSTHOG_HOST = "https://app.posthog.com";
const SENTRY_DSN = "https://8d9fe8f972b0b2aacf7720b1cd8c927b@o4511422658314240.ingest.us.sentry.io/4512074829529088";
const DISTINCT_KEY = "voicelatte.telemetryId";

const KEY_LIKE = /(sk-|ghp_|github_pat_|gho_|AIzaSy|sk-ant-|xai-|gsk_|AKIA[0-9A-Z]{16}|xox[baprs]-|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)[A-Za-z0-9_./+=:-]*/g;

export function scrubText(value: string): string {
  return value.replace(KEY_LIKE, "[redacted]").slice(0, 500);
}

let enabled = false;
let sentryReady = false;

function distinctId(): string {
  try {
    let id = localStorage.getItem(DISTINCT_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DISTINCT_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

async function posthogCapture(event: string, props: Record<string, string | number | boolean>): Promise<void> {
  const scrubbed: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) scrubbed[k] = typeof v === "string" ? scrubText(v) : v;
  const body = JSON.stringify({
    api_key: POSTHOG_KEY,
    event,
    distinct_id: distinctId(),
    properties: scrubbed,
    timestamp: new Date().toISOString(),
  });
  const response = await fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  });
  if (!response.ok) throw new Error(`posthog ${response.status}`);
}

async function sentryClient() {
  const Sentry = await import("@sentry/browser");
  if (!sentryReady) {
    Sentry.init({
      dsn: SENTRY_DSN,
      enabled: false,
      tracesSampleRate: 0,
      environment: import.meta.env.DEV ? "development" : "production",
      beforeSend(event) {
        if (event.message) event.message = scrubText(event.message);
        event.exception?.values?.forEach((v) => {
          if (v.value) v.value = scrubText(v.value);
        });
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map((b) => ({ ...b, message: b.message ? scrubText(b.message) : b.message, data: undefined }));
        }
        if (event.request?.url) event.request.url = event.request.url.split("?")[0];
        delete event.user;
        return event;
      },
    });
    sentryReady = true;
  }
  return Sentry;
}

export async function setTelemetryEnabled(on: boolean): Promise<void> {
  enabled = on;
  if (on) {
    try {
      const Sentry = await sentryClient();
      const client = Sentry.getClient();
      if (client) client.getOptions().enabled = true;
    } catch { /* SDK取得失敗は無視 */ }
  } else if (sentryReady) {
    try {
      const Sentry = await sentryClient();
      const client = Sentry.getClient();
      if (client) client.getOptions().enabled = false;
    } catch { /* ignore */ }
  }
  try {
    await invoke("set_telemetry_consent", { enabled: on }).catch(() => undefined);
  } catch { /* ignore */ }
}

// applog の error 経路から呼ぶ。同意オフなら何もしない。
export function reportError(tag: string, message: string): void {
  if (!enabled) return;
  const scrubbed = scrubText(message);
  void (async () => {
    try {
      const Sentry = await sentryClient();
      Sentry.captureMessage(`[${tag}] ${scrubbed}`, "error");
    } catch { /* 収集失敗は無視 */ }
  })();
  void posthogCapture("$exception", { $exception_message: scrubbed, tag }).catch(() => undefined);
}

// 失敗系イベント（縮退・復活など）。同意オフなら何もしない。
export function trackEvent(name: string, props: Record<string, string | number | boolean> = {}): void {
  if (!enabled) return;
  void posthogCapture(name, props).catch(() => undefined);
}
