import { useState } from "react";
import type { CloudHistoryEntry } from "../types";

// 測定履歴の保持上限（新しいものから5件）
const MAX_HISTORY = 5;

// 測定履歴（点群）のデータ管理。追加・リネーム・削除を提供する。
// 編集中/削除確認などの UI 状態は呼び出し側（App）が保持する。
export function useCloudHistory() {
  const [history, setHistory] = useState<CloudHistoryEntry[]>([]);

  const pushEntry = (entry: CloudHistoryEntry) =>
    setHistory((prev) => [entry, ...prev].slice(0, MAX_HISTORY));

  const renameEntry = (index: number, name: string) =>
    setHistory((prev) => prev.map((h, i) => (i === index ? { ...h, name } : h)));

  const removeEntry = (index: number) => setHistory((prev) => prev.filter((_, i) => i !== index));

  return { history, pushEntry, renameEntry, removeEntry };
}
