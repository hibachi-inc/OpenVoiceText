import { Command, type Child } from "@tauri-apps/plugin-shell";
import { appLog } from "./applog";

export type SpeechStatus = {
  id: number;
  type: "status" | "error";
  platform: "macos" | "windows";
  backend: "apple-speech-analyzer" | "apple-speech-classic" | "microsoft-windows-ai-speech";
  modelState: "ready" | "download-required" | "unsupported" | "unknown";
  supportsStreaming: boolean;
  message: string;
};

type BridgeEvent = Omit<Partial<SpeechStatus>, "id" | "type"> & {
  id: number;
  type: "status" | "settings" | "ready" | "started" | "engine" | "transcript" | "audio_level" | "final" | "refined" | "inserted" | "installed" | "context" | "shortcut" | "screenshot" | "error";
  text?: string;
  image?: string;
  level?: number;
  message?: string;
  appName?: string;
  bundleID?: string;
  category?: string;
  promptKey?: string;
  screenContext?: string;
  displayX?: number;
  displayY?: number;
  shortcut?: string;
  devices?: { uid: string; name: string }[];
  microphonePermission?: DeviceSettingsStatus["microphonePermission"];
  speechPermission?: DeviceSettingsStatus["speechPermission"];
  accessibilityPermission?: DeviceSettingsStatus["accessibilityPermission"];
};

export type RecordingCallbacks = {
  onTranscript: (text: string) => void;
  onAudioLevel: (level: number) => void;
  onEngine: (backend: string) => void;
  onError: (message: string) => void;
};

export type DeviceSettingsStatus = {
  platform: "macos" | "windows";
  devices: { uid: string; name: string }[];
  microphonePermission: "authorized" | "not-determined" | "denied" | "system-managed";
  speechPermission: "authorized" | "not-determined" | "denied" | "system-managed";
  accessibilityPermission: "authorized" | "denied" | "not-required";
};

export class SpeechBridgeClient {
  private child?: Child;
  private starting?: Promise<void>;
  private nextId = 1;
  private recordingId?: number;
  private callbacks?: RecordingCallbacks;
  private shortcutListener?: (shortcut: string, state: "Pressed" | "Released") => void;
  private modifierShortcuts: string[] = [];
  // 子プロセスの世代。旧プロセスの close 通知が新プロセスの状態を壊さないための識別子。
  private generation = 0;
  private pending = new Map<number, {
    accept: (event: BridgeEvent) => boolean;
    resolve: (event: BridgeEvent) => void;
    reject: (error: Error) => void;
    timer: number;
  }>();

  async status(locale: string): Promise<SpeechStatus> {
    const event = await this.request({ command: "status", locale }, ["status"], 5000);
    return event as SpeechStatus;
  }

  async warmUp(locale: string) {
    await this.request({ command: "warm_up", locale }, ["ready"], 5000);
  }

  async installModel(locale: string) {
    await this.request({ command: "install_model", locale }, ["installed"], 10 * 60 * 1000);
  }

  async context() {
    const event = await this.request({ command: "context" }, ["context"], 3000);
    return {
      platform: event.platform,
      appName: event.appName ?? "Unknown",
      bundleID: event.bundleID,
      category: event.category ?? "generic",
      promptKey: event.promptKey,
      screenContext: event.screenContext,
      displayX: event.displayX,
      displayY: event.displayY,
    };
  }

  // 入力先ディスプレイのスクリーンショット（JPEG base64）。権限なし・失敗はnull。
  async screenshot(x?: number, y?: number): Promise<string | null> {
    try {
      const event = await this.request({ command: "screenshot", displayX: x, displayY: y }, ["screenshot"], 8000);
      return event.image ?? null;
    } catch {
      return null;
    }
  }

  async settingsStatus(): Promise<DeviceSettingsStatus> {
    const event = await this.request({ command: "settings_status" }, ["settings"], 5000);
    return {
      platform: event.platform ?? "macos",
      devices: event.devices ?? [],
      microphonePermission: event.microphonePermission ?? "system-managed",
      speechPermission: event.speechPermission ?? "system-managed",
      accessibilityPermission: event.accessibilityPermission ?? "not-required",
    };
  }

  async requestPermission(permission: "microphone" | "speech" | "accessibility") {
    await this.request({ command: "request_permission", permission }, ["ready"], 10000);
  }

  async start(
    locale: string,
    vocabulary: string[],
    deviceUID: string,
    muteOtherAudio: boolean,
    callbacks: RecordingCallbacks,
    cloud?: { audioPath: string; provider: "groq" | "gemini" },
  ) {
    await this.ensureStarted();
    const id = this.nextId++;
    this.recordingId = id;
    this.callbacks = callbacks;
    appLog.info("bridge", `-> start (id=${id})`);
    await this.waitFor(id, ["started"], 10000, () => {
      void this.child?.write(`${JSON.stringify({
        id,
        command: "start",
        locale,
        vocabulary,
        deviceUID,
        muteOtherAudio,
        audioPath: cloud?.audioPath,
        cloudProvider: cloud ? `${cloud.provider}-cloud` : undefined,
      })}\n`);
    });
  }

  async stop(): Promise<{ text: string; engine: string }> {
    if (!this.recordingId) return { text: "", engine: "" };
    const id = this.nextId++;
    const event = await this.request({ command: "stop" }, ["final"], 10000, id);
    this.recordingId = undefined;
    this.callbacks = undefined;
    return { text: event.text ?? "", engine: event.backend ?? "" };
  }

  async cancel() {
    if (!this.recordingId) return;
    const id = this.nextId++;
    await this.request({ command: "cancel" }, ["final"], 10000, id);
    this.recordingId = undefined;
    this.callbacks = undefined;
  }

  async refine(text: string, category: string, prompt: string, locale: string, screenContext = ""): Promise<string> {
    const event = await this.request({ command: "refine", text, category, prompt, locale, screenContext }, ["refined"], 30000);
    return event.text ?? text;
  }

  async insert(text: string, autoPaste: boolean) {
    await this.request({ command: "insert", text, autoPaste }, ["inserted"], 5000);
  }

  async configureModifierShortcuts(shortcuts: string[], listener: (shortcut: string, state: "Pressed" | "Released") => void) {
    this.shortcutListener = listener;
    this.modifierShortcuts = shortcuts;
    await this.request({ command: "configure_shortcut", shortcuts }, ["ready"], 5000);
  }

  async close() {
    await this.starting;
    this.generation++;
    await this.child?.kill();
    this.child = undefined;
  }

  // 起動処理の完了を待たずに子プロセスを捨てる。waitFor のタイムアウト専用。
  // close() は starting を待つため、起動中のタイムアウトから呼ぶと自己デッドロックする。
  private async hardReset() {
    // 先に世代を進め、旧プロセスの close 通知が新プロセスを壊さないようにする
    this.generation++;
    const child = this.child;
    this.child = undefined;
    this.recordingId = undefined;
    const callbacks = this.callbacks;
    this.callbacks = undefined;
    // 子プロセスを失う以上、待機中の要求は成立しないのですべて棄却する
    const pendings = [...this.pending.values()];
    this.pending.clear();
    for (const { reject, timer } of pendings) {
      window.clearTimeout(timer);
      reject(new Error("音声認識ブリッジから応答がありません"));
    }
    try {
      await child?.kill();
    } catch {
      // 終了済み・起動失敗時は無視する
    }
    callbacks?.onError("音声認識ブリッジから応答がありません");
  }

  private async request(
    payload: Record<string, unknown>,
    expected: BridgeEvent["type"][],
    timeout: number,
    suppliedId?: number,
  ) {
    // 起動待ち自体にも上限を付け、固まったまま preparing に留まるのを防ぐ
    const started = this.ensureStarted();
    const startupTimeout = new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error("音声認識ブリッジの起動がタイムアウトしました")), 15000);
    });
    try {
      await Promise.race([started, startupTimeout]);
    } catch (error) {
      appLog.error("bridge", `ensureStarted failed: ${error instanceof Error ? error.message : String(error)}`);
      void this.hardReset();
      throw error;
    }
    const id = suppliedId ?? this.nextId++;
    const command = String(payload.command ?? "unknown");
    appLog.info("bridge", `-> ${command} (id=${id})`);
    return this.waitFor(id, expected, timeout, () => {
      void this.child?.write(`${JSON.stringify({ id, ...payload })}\n`);
    });
  }

  private waitFor(
    id: number,
    expected: BridgeEvent["type"][],
    timeout: number,
    send: () => void,
  ): Promise<BridgeEvent> {
    return new Promise((resolve, reject) => {
      // タイムアウト時点で世代が進んでいたら、既に別のタイムアウトが復旧済みのため何もしない
      const generation = this.generation;
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        // 同世代のまま＝自分が最初のタイムアウトのときだけ復旧処理を行う
        if (generation === this.generation) void this.hardReset();
        else appLog.warn("bridge", `request ${id} timed out after hardReset by another request`);
        reject(new Error("音声認識ブリッジから応答がありません"));
      }, timeout);
      this.pending.set(id, {
        accept: (event) => expected.includes(event.type),
        resolve,
        reject,
        timer,
      });
      send();
    });
  }

  private async ensureStarted() {
    if (this.child) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const generation = ++this.generation;
      appLog.info("bridge", `spawning child (generation ${generation})`);
      const command = Command.sidecar("binaries/voicelatte-speech");
      command.stdout.on("data", (line) => this.receive(line));
      command.stderr.on("data", (line) => {
        console.error(`[speech-bridge] ${line}`);
        appLog.error("bridge-stderr", line);
      });
      command.on("close", () => {
        // 旧世代プロセスの通知は無視する
        if (generation !== this.generation) return;
        this.child = undefined;
        appLog.error("bridge", "child process closed");
        const error = new Error("音声認識ブリッジが終了しました");
        this.pending.forEach(({ reject, timer }) => {
          window.clearTimeout(timer);
          reject(error);
        });
        this.pending.clear();
        this.callbacks?.onError(error.message);
      });
      const spawned = await command.spawn();
      // その間にリセットされていたら古いプロセスは捨てる
      if (generation !== this.generation) {
        await spawned.kill().catch(() => undefined);
        return;
      }
      this.child = spawned;
      // 再起動後に修飾キーショートカットを復元する
      if (this.modifierShortcuts.length > 0) {
        await this.request({ command: "configure_shortcut", shortcuts: this.modifierShortcuts }, ["ready"], 5000);
      }
    })().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private receive(line: string) {
    let event: BridgeEvent;
    try {
      event = JSON.parse(line) as BridgeEvent;
    } catch {
      console.error(`[speech-bridge] Invalid response: ${line}`);
      return;
    }

    if (event.type === "shortcut") {
      this.shortcutListener?.(event.shortcut ?? "", event.message === "Pressed" ? "Pressed" : "Released");
      return;
    }

    const pending = this.pending.get(event.id);
    if (pending && event.type === "error") {
      window.clearTimeout(pending.timer);
      this.pending.delete(event.id);
      pending.reject(new Error(event.message ?? "音声認識エラー"));
      return;
    }
    if (pending?.accept(event)) {
      window.clearTimeout(pending.timer);
      this.pending.delete(event.id);
      appLog.info("bridge", `<- ${event.type} (id=${event.id})${event.type === "status" ? ` backend=${event.backend ?? ""} model=${event.modelState ?? ""}` : ""}`);
      pending.resolve(event);
      return;
    }
    if (event.id !== this.recordingId) return;
    if (event.type === "transcript") this.callbacks?.onTranscript(event.text ?? "");
    if (event.type === "audio_level") this.callbacks?.onAudioLevel(event.level ?? 0);
    if (event.type === "engine") this.callbacks?.onEngine(event.backend ?? "");
    if (event.type === "error") this.callbacks?.onError(event.message ?? "音声認識エラー");
  }
}
