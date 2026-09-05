import { Command, type Child } from "@tauri-apps/plugin-shell";

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
  type: "status" | "settings" | "ready" | "started" | "engine" | "transcript" | "audio_level" | "final" | "refined" | "inserted" | "installed" | "context" | "shortcut" | "error";
  text?: string;
  level?: number;
  message?: string;
  appName?: string;
  bundleID?: string;
  category?: string;
  promptKey?: string;
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
      appName: event.appName ?? "Unknown",
      bundleID: event.bundleID,
      category: event.category ?? "generic",
      promptKey: event.promptKey,
    };
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

  async start(locale: string, vocabulary: string[], deviceUID: string, muteOtherAudio: boolean, callbacks: RecordingCallbacks) {
    await this.ensureStarted();
    const id = this.nextId++;
    this.recordingId = id;
    this.callbacks = callbacks;
    await this.waitFor(id, ["started"], 10000, () => {
      void this.child?.write(`${JSON.stringify({ id, command: "start", locale, vocabulary, deviceUID, muteOtherAudio })}\n`);
    });
  }

  async stop(): Promise<string> {
    if (!this.recordingId) return "";
    const id = this.nextId++;
    const event = await this.request({ command: "stop" }, ["final"], 10000, id);
    this.recordingId = undefined;
    this.callbacks = undefined;
    return event.text ?? "";
  }

  async cancel() {
    if (!this.recordingId) return;
    const id = this.nextId++;
    await this.request({ command: "cancel" }, ["final"], 10000, id);
    this.recordingId = undefined;
    this.callbacks = undefined;
  }

  async refine(text: string, category: string, prompt: string): Promise<string> {
    const event = await this.request({ command: "refine", text, category, prompt }, ["refined"], 30000);
    return event.text ?? text;
  }

  async insert(text: string, autoPaste: boolean) {
    await this.request({ command: "insert", text, autoPaste }, ["inserted"], 5000);
  }

  async configureModifierShortcuts(shortcuts: string[], listener: (shortcut: string, state: "Pressed" | "Released") => void) {
    this.shortcutListener = listener;
    await this.request({ command: "configure_shortcut", shortcuts }, ["ready"], 5000);
  }

  async close() {
    await this.starting;
    await this.child?.kill();
    this.child = undefined;
  }

  private async request(
    payload: Record<string, unknown>,
    expected: BridgeEvent["type"][],
    timeout: number,
    suppliedId?: number,
  ) {
    await this.ensureStarted();
    const id = suppliedId ?? this.nextId++;
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
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
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
      const command = Command.sidecar("binaries/voicelatte-speech");
      command.stdout.on("data", (line) => this.receive(line));
      command.stderr.on("data", (line) => console.error(`[speech-bridge] ${line}`));
      command.on("close", () => {
        this.child = undefined;
        const error = new Error("音声認識ブリッジが終了しました");
        this.pending.forEach(({ reject, timer }) => {
          window.clearTimeout(timer);
          reject(error);
        });
        this.pending.clear();
        this.callbacks?.onError(error.message);
      });
      this.child = await command.spawn();
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
