import { useEffect, useRef, useState } from "react";
import type { CloudHistoryEntry, DataOrigin } from "../types";
import {
  clearAll,
  decodeData,
  deleteEntry,
  encodeData,
  loadData,
  loadMetas,
  saveEntry,
  storageUsage,
  updateMeta,
  type HistoryMeta,
} from "../utils/historyStore";

// 測定履歴の保持上限（新しいものから。ブラウザに保存し、再読み込みしても残る）
export const MAX_HISTORY = 20;
// 点群・高さマップをメモリに持っておく件数（それより古いものは復元時にブラウザの保存から読む）
const KEEP_IN_MEMORY = 5;

// 一覧の1件。full は復元に使う全データ（メモリにあるときだけ）。saved=ブラウザに保存済み、
// saveFailed=容量不足などで保存できなかった（この回だけの履歴。再読み込みで消える）
export type HistoryItem = HistoryMeta & {
  full?: CloudHistoryEntry;
  saved?: boolean;
  saveFailed?: boolean;
};

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

// 履歴の id と保存時刻（並べ替え用）
function newHistoryId(): { id: string; savedAt: number } {
  const savedAt = Date.now();
  return { id: `${savedAt}-${Math.random().toString(36).slice(2, 8)}`, savedAt };
}

// 測定履歴のデータ管理。追加・リネーム・削除・復元用の読み出しを提供する。
// 編集中/削除確認などの UI 状態は呼び出し側（App）が保持する。
export function useCloudHistory() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // ブラウザに保存している量[バイト]（一覧に表示）
  const [usage, setUsage] = useState<number | null>(null);
  const refreshUsage = () => void storageUsage().then(setUsage);
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
    refreshUsage();
    return () => {
      cancelled = true;
    };
  }, []);

  // 追加した履歴の id を返す（表示中の印に使う）
  const pushEntry = (entry: CloudHistoryEntry): string => {
    const { id, savedAt } = newHistoryId();
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
    void saveWithEviction(meta, encodeData(entry)).then((ok) => {
      commit(
        historyRef.current.map((h) => (h.id === id ? { ...h, saved: ok, saveFailed: !ok } : h))
      );
      refreshUsage();
    });
    return id;
  };

  // 容量不足で保存できないときは、保存済みのいちばん古い履歴から消して入れ直す（最大3件まで）。
  // 消した履歴は一覧からも外す（メモリに全データが無いと復元できなくなるため）
  const saveWithEviction = async (
    meta: HistoryMeta,
    data: ReturnType<typeof encodeData>
  ): Promise<boolean> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await saveEntry(meta, data)) return true;
      const oldest = [...historyRef.current].reverse().find((h) => h.saved && h.id !== meta.id);
      if (!oldest) return false;
      await deleteEntry(oldest.id);
      commit(historyRef.current.filter((h) => h.id !== oldest.id));
    }
    return false;
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
    void deleteEntry(h.id).then(refreshUsage);
  };

  // すべての履歴を消す（ブラウザの保存も）
  const clearHistory = () => {
    commit([]);
    void clearAll().then(refreshUsage);
  };

  // 復元用の全データ（メモリに無ければブラウザの保存から読む）。読めなければ null
  const loadEntry = async (item: HistoryItem): Promise<CloudHistoryEntry | null> => {
    if (item.full) return item.full;
    const d = await loadData(item.id);
    if (!d) return null;
    return { ...metaFields(item), ...decodeData(d) };
  };

  return { history, usage, pushEntry, renameEntry, removeEntry, clearHistory, loadEntry };
}
