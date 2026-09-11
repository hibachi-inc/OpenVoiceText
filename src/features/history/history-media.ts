import type { HistoryEntry } from "../../app/types";

const IMAGE_RETENTION_MS = 24 * 3600 * 1000;

// 履歴保存用にスクショを縮小する（localStorage肥大防止）。失敗時はnull。
// JPEG base64をWebP base64へ変換する。未対応環境ではnull。
// ImageIOはWebP書き出しに未対応のためブラウザ側で変換する。
// toDataURLは非対応形式でPNGを返すため、先頭検証で取りこぼさない。
export async function jpegToWebp(base64: string, quality = 0.8): Promise<{ data: string; mime: string } | null> {
  try {
    const blob = await (await fetch(`data:image/jpeg;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const url = canvas.toDataURL("image/webp", quality);
    if (!url.startsWith("data:image/webp,")) return null;
    const data = url.split(",", 2)[1] ?? "";
    if (!data) return null;
    return { data, mime: "image/webp" };
  } catch {
    return null;
  }
}

export async function makeHistoryThumbnail(base64: string, mime = "image/jpeg", maxEdge = 768): Promise<string | null> {
  try {
    const blob = await (await fetch(`data:${mime};base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.6).split(",", 2)[1] ?? null;
  } catch {
    return null;
  }
}

// 24時間より古い撮影画像を取り除く（テキストは残す）。
export function purgeExpiredImages(items: HistoryEntry[]): HistoryEntry[] {
  const cutoff = Date.now() - IMAGE_RETENTION_MS;
  let changed = false;
  const next = items.map((entry) => {
    if (entry.image && entry.createdAt < cutoff) {
      changed = true;
      const pruned = { ...entry };
      delete pruned.image;
      return pruned;
    }
    return entry;
  });
  return changed ? next : items;
}
