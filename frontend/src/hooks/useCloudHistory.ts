import { useEffect, useRef, useState } from "react";
import type { CloudHistoryEntry, DataOrigin } from "../types";
import {
  decodeData,
  deleteEntry,
  encodeData,
  loadData,
  loadMetas,
  saveEntry,
  updateMeta,
  type HistoryMeta,
} from "../utils/historyStore";

// 測定履歴の保持上限（新しいものから。ブラウザに保存し、再読み込みしても残る）
export const MAX_HISTORY = 20;
// 点群・高さマップをメモリに持っておく件数（それより古いものは復元時にブラウザの保存から読む）
const KEEP_IN_MEMORY = 5;

// 一覧の1件。full は復元に使う全データ（メモリにあるときだけ）。saved=ブラウザに保存済み
export type HistoryItem = HistoryMeta & { full?: CloudHistoryEntry; saved?: boolean };

// 同じ結果フォルダを使う（後の計測・読込で画像が上書きされる）か
function sharesFolder(a: DataOrigin, b: DataOrigin): boolean {
  if (a?.kind !== "folder" || b?.kind !== "folder") return false;
  const u = a.src.folderUrl;
  const v = b.src.folderUrl;
  return u === v || u.startsWith(v + "/") || v.startsWith(u + "/");
}

// 一覧に出す軽い項目（点群・高さマップ・出どころ以外）
type MetaFields = Omit<CloudHistoryEntry, "cloud" | "grid" | "origin">;
const metaFields = (e: MetaFields): MetaFields => ({
  plotType: e.plotType,
  dataSource: e.dataSource,
  dataName: e.dataName,
  processing: e.processing,
  measuredAt: e.measuredAt,
  points: e.points,
  thumbnail: e.thumbnail,
  name: e.name,
  source: e.source,
});

const toSnapshot = (e: CloudHistoryEntry): CloudHistoryEntry =>
  e.origin?.kind === "folder" ? { ...e, origin: { kind: "snapshot", layers: e.origin.layers } } : e;

// 測定履歴のデータ管理。追加・リネーム・削除・復元用の読み出しを提供する。
// 編集中/削除確認などの UI 状態は呼び出し側（App）が保持する。
export function useCloudHistory() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const historyRef = useRef<HistoryItem[]>([]);
  const commit = (next: HistoryItem[]) => {
    historyRef.current = next;
    setHistory(next);
  };

  // 起動時に保存済みの履歴を読み込む（この回で先に追加された分は先頭に残す）
  useEffect(() => {
    let cancelled = false;
    loadMetas().then((metas) => {
      if (cancelled || metas.length === 0) return;
      const have = new Set(historyRef.current.map((h) => h.id));
      const loaded = metas
        .filter((m) => !have.has(m.id))
        .map((m): HistoryItem => ({ ...m, saved: true }));
      const merged = [...historyRef.current, ...loaded].sort((a, b) => b.savedAt - a.savedAt);
      merged.slice(MAX_HISTORY).forEach((h) => void deleteEntry(h.id));
      commit(merged.slice(0, MAX_HISTORY));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 追加した履歴の id を返す（表示中の印に使う）
  const pushEntry = (entry: CloudHistoryEntry): string => {
    const savedAt = Date.now();
    const id = `${savedAt}-${Math.random().toString(36).slice(2, 8)}`;
    const meta: HistoryMeta = { ...metaFields(entry), id, savedAt };
    const prev = historyRef.current.map((h, i): HistoryItem => {
      // 同じ結果フォルダの古い履歴は、画像が上書きされるので「その時点の点」で戻すようにする
      let full = h.full && sharesFolder(h.full.origin, entry.origin) ? toSnapshot(h.full) : h.full;
      // 保存済みの古いものはメモリから外す（復元時に読み直す）
      if (h.saved && i + 1 >= KEEP_IN_MEMORY) full = undefined;
      return { ...h, full };
    });
    const next = [{ ...meta, full: entry }, ...prev];
    next.slice(MAX_HISTORY).forEach((h) => void deleteEntry(h.id));
    commit(next.slice(0, MAX_HISTORY));
    void saveEntry(meta, encodeData(entry)).then((ok) => {
      if (ok) commit(historyRef.current.map((h) => (h.id === id ? { ...h, saved: true } : h)));
    });
    return id;
  };

  const renameEntry = (index: number, name: string) => {
    const next = historyRef.current.map((h, i) => (i === index ? { ...h, name } : h));
    commit(next);
    const h = next[index];
    if (h?.saved) void updateMeta({ ...metaFields(h), id: h.id, savedAt: h.savedAt });
  };

  const removeEntry = (index: number) => {
    const h = historyRef.current[index];
    if (!h) return;
    commit(historyRef.current.filter((_, i) => i !== index));
    void deleteEntry(h.id);
  };

  // 復元用の全データ（メモリに無ければブラウザの保存から読む）。読めなければ null
  const loadEntry = async (item: HistoryItem): Promise<CloudHistoryEntry | null> => {
    if (item.full) return item.full;
    const d = await loadData(item.id);
    if (!d) return null;
    return { ...metaFields(item), ...decodeData(d) };
  };

  return { history, pushEntry, renameEntry, removeEntry, loadEntry };
}
