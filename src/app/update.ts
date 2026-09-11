import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; version: string; update: Awaited<ReturnType<typeof checkUpdate>> }
  | { status: "downloading"; version: string }
  | { status: "ready" }
  | { status: "error"; message: string };

export async function runUpdateCheck(setState: (state: UpdateState) => void, manual: boolean) {
  if (manual) setState({ status: "checking" });
  try {
    const update = await checkUpdate();
    if (update) setState({ status: "available", version: update.version, update });
    else if (manual) setState({ status: "current" });
  } catch (error) {
    if (manual) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

export async function installUpdate(state: UpdateState, setState: (state: UpdateState) => void) {
  if (state.status !== "available" || !state.update) return;
  setState({ status: "downloading", version: state.version });
  try {
    await state.update.downloadAndInstall();
    setState({ status: "ready" });
    await relaunch();
  } catch (error) {
    setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
