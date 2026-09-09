import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const binaries = join(root, "src-tauri", "binaries");
mkdirSync(binaries, { recursive: true });

// Mac専用。Windowsサイドカーは未検証のため削除済み（復活時はgit履歴から）。
if (process.platform !== "darwin") {
  throw new Error(`Unsupported platform: ${process.platform} (macOS only)`);
}

const packagePath = join(root, "native", "macos");
execFileSync("swift", ["build", "-c", "release", "--package-path", packagePath], { stdio: "inherit" });
copyFileSync(
  join(packagePath, ".build", "release", "voicelatte-speech"),
  join(binaries, `voicelatte-speech-${target}`),
);
