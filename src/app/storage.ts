import { useEffect, useState } from "react";

export function useStoredState<T>(key: string, initial: T, normalize?: (stored: unknown) => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "") as unknown;
      return normalize ? normalize(stored) : stored as T;
    } catch { return initial; }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // クォータ超過時は画像だけ捨てて再試行する（履歴サムネ用）。
      // それでもだめなら永続化を諦める（メモリ上の値は維持）。
      try {
        localStorage.setItem(key, JSON.stringify(value, (k, v) => (k === "image" ? undefined : v)));
      } catch { /* ignore */ }
    }
  }, [key, value]);
  return [value, setValue] as const;
}
