import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const suffix = process.platform === "win32" ? ".exe" : "";
const binary = join(root, "src-tauri", "binaries", `voicelatte-speech-${target}${suffix}`);
const expectedPlatform = process.platform === "darwin" ? "macos" : "windows";
const child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] });
let buffer = "";

async function request(payload) {
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Native bridge timed out")), 5000);
    const onData = (data) => {
      buffer += String(data);
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      clearTimeout(timer);
      child.stdout.off("data", onData);
      resolve(JSON.parse(line));
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
  });
}

const response = await request({ id: 1, command: "status", locale: "ja-JP" });

if (response.id !== 1 || response.type !== "status" || response.platform !== expectedPlatform) {
  throw new Error(`Unexpected native bridge response: ${JSON.stringify(response)}`);
}

const settings = await request({ id: 2, command: "settings_status" });
if (settings.id !== 2 || settings.type !== "settings" || !Array.isArray(settings.devices)) {
  throw new Error(`Unexpected settings response: ${JSON.stringify(settings)}`);
}

const shortcuts = await request({ id: 3, command: "configure_shortcut", shortcuts: ["Control", "Shift"] });
if (shortcuts.id !== 3 || shortcuts.type !== "ready") {
  throw new Error(`Unexpected shortcut response: ${JSON.stringify(shortcuts)}`);
}
await request({ id: 4, command: "configure_shortcut", shortcuts: [] });
child.stdin.end();

console.log(`${response.backend}: ${response.modelState}`);
