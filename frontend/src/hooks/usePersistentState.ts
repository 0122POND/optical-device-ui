import { useEffect, useState } from "react";

// ブラウザ(localStorage)に保存される文字列 state。リロードしても設定値が残る。
// プライベートモード等で localStorage が使えない環境では、保存せずに普通の state として動く
export function usePersistentState(key: string, initial: string): [string, (v: string) => void] {
  const storageKey = `toriton:${key}`;
  const [value, setValue] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      return saved ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      // 保存できなくても表示・計算には影響しない
    }
  }, [storageKey, value]);
  return [value, setValue];
}
