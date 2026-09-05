import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const binaries = join(root, "src-tauri", "binaries");
mkdirSync(binaries, { recursive: true });

if (process.platform === "darwin") {
  const packagePath = join(root, "native", "macos");
  execFileSync("swift", ["build", "-c", "release", "--package-path", packagePath], { stdio: "inherit" });
  copyFileSync(
    join(packagePath, ".build", "release", "voicelatte-speech"),
    join(binaries, `voicelatte-speech-${target}`),
  );
} else if (process.platform === "win32") {
  const project = join(root, "native", "windows", "VoiceLatte.SpeechBridge", "VoiceLatte.SpeechBridge.csproj");
  const runtime = process.arch === "arm64" ? "win-arm64" : "win-x64";
  const output = join(root, "native", "windows", "publish", runtime);
  execFileSync("dotnet", ["publish", project, "-c", "Release", "-r", runtime, "-o", output], { stdio: "inherit" });
  copyFileSync(
    join(output, "VoiceLatte.SpeechBridge.exe"),
    join(binaries, `voicelatte-speech-${target}.exe`),
  );
} else {
  throw new Error(`Unsupported platform: ${process.platform}`);
}
