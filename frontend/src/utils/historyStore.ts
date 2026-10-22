// 測定履歴をブラウザ（IndexedDB）に保存し、再読み込みしても残るようにする。
// 一覧（サムネイル・名前など軽いもの）と、復元に使う重いデータ（点群・高さマップ）を分けて持ち、
// 重いデータは復元するときだけ読む。値は Float64Array で持つ（CSV出力で桁が変わらないように）。
import type { CloudHistoryEntry, DataOrigin } from "../types";
import type { PointCloud } from "./pointCloud";

type Grid = (number | null)[][];

export type HistoryMeta = Omit<CloudHistoryEntry, "cloud" | "grid" | "origin"> & {
  id: string;
  savedAt: number; // 並べ替え用（Date.now()）
};

type StoredGrid = { w: number; h: number; data: Float64Array };
type StoredCloud = { x: Float64Array; y: Float64Array; z: Float64Array; c: Float64Array };
type StoredOrigin =
  | { kind: "csv"; sameAsGrid: true }
  | { kind: "csv"; grid: StoredGrid }
  | { kind: "csvPoints"; points: StoredCloud }
  | { kind: "snapshot"; layers: StoredCloud | null }
  | null;
export type StoredData = { cloud: StoredCloud; grid: StoredGrid | null; origin: StoredOrigin };

export function encodeGrid(grid: Grid): StoredGrid {
  const h = grid.length;
  const w = h > 0 ? grid[0].length : 0;
  const data = new Float64Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data[r * w + c] = grid[r][c] ?? NaN;
  return { w, h, data };
}

export function decodeGrid(g: StoredGrid): Grid {
  const out: Grid = [];
  for (let r = 0; r < g.h; r++) {
    const row: (number | null)[] = new Array(g.w);
    for (let c = 0; c < g.w; c++) {
      const v = g.data[r * g.w + c];
      row[c] = Number.isNaN(v) ? null : v;
    }
    out.push(row);
  }
  return out;
}

const encodeCloud = (p: PointCloud): StoredCloud => ({
  x: Float64Array.from(p.x),
  y: Float64Array.from(p.y),
  z: Float64Array.from(p.z),
  c: Float64Array.from(p.c),
});
const decodeCloud = (p: StoredCloud): PointCloud => ({
  x: Array.from(p.x),
  y: Array.from(p.y),
  z: Array.from(p.z),
  c: Array.from(p.c),
});

// フォルダ由来の履歴は、サーバーの結果画像が後の計測で上書きされうるので、保存時は
// 「その時点の点（層ごとの点）」だけを残す（snapshot）。復元後に画像を取り直さない
export function encodeData(e: CloudHistoryEntry): StoredData {
  const o = e.origin;
  let origin: StoredOrigin = null;
  if (o?.kind === "csv")
    origin =
      o.grid === e.grid
        ? { kind: "csv", sameAsGrid: true }
        : { kind: "csv", grid: encodeGrid(o.grid) };
  else if (o?.kind === "csvPoints") origin = { kind: "csvPoints", points: encodeCloud(o.points) };
  else if (o?.kind === "folder" || o?.kind === "snapshot")
    origin = { kind: "snapshot", layers: o.layers ? encodeCloud(o.layers) : null };
  return { cloud: encodeCloud(e.cloud), grid: e.grid ? encodeGrid(e.grid) : null, origin };
}

export function decodeData(d: StoredData): Pick<CloudHistoryEntry, "cloud" | "grid" | "origin"> {
  const grid = d.grid ? decodeGrid(d.grid) : null;
  let origin: DataOrigin = null;
  const o = d.origin;
  if (o?.kind === "csv")
    origin = { kind: "csv", grid: "sameAsGrid" in o ? (grid ?? []) : decodeGrid(o.grid) };
  else if (o?.kind === "csvPoints") origin = { kind: "csvPoints", points: decodeCloud(o.points) };
  else if (o?.kind === "snapshot")
    origin = { kind: "snapshot", layers: o.layers ? decodeCloud(o.layers) : null };
  return { cloud: decodeCloud(d.cloud), grid, origin };
}

// --- IndexedDB（使えない環境では何もしない＝その回だけの履歴になる） ---
const DB_NAME = "toriton-history";
const META = "meta";
const DATA = "data";

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(META, { keyPath: "id" });
        req.result.createObjectStore(DATA);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function loadMetas(): Promise<HistoryMeta[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const req = db.transaction(META).objectStore(META).getAll();
    req.onsuccess = () => resolve(req.result as HistoryMeta[]);
    req.onerror = () => resolve([]);
  });
}

export async function loadData(id: string): Promise<StoredData | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(DATA).objectStore(DATA).get(id);
    req.onsuccess = () => resolve((req.result as StoredData) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function saveEntry(meta: HistoryMeta, data: StoredData): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction([META, DATA], "readwrite");
    tx.objectStore(META).put(meta);
    tx.objectStore(DATA).put(data, meta.id);
    await done(tx);
    return true;
  } catch (e) {
    console.warn("測定履歴を保存できませんでした", e);
    return false;
  }
}

export async function updateMeta(meta: HistoryMeta): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction(META, "readwrite");
  tx.objectStore(META).put(meta);
  await done(tx).catch(() => undefined);
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction([META, DATA], "readwrite");
  tx.objectStore(META).delete(id);
  tx.objectStore(DATA).delete(id);
  await done(tx).catch(() => undefined);
}
