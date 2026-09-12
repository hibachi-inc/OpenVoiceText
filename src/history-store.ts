import type { HistoryEntry } from "./types";

export const IMAGE_RETENTION_MS = 24 * 3600 * 1000;

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
