"""前処理・AI推論の結果から、行ごとの縞位置（深さ）をサブピクセル精度で求めて書き出す。

従来はフロントエンドが結果PNG（二値の線）の重心から深さを求めていたため、整数画素＋二値マスクの
重心になり、高さマップが 0.5px 刻みの段々畑になっていた。ここでは
  - 古典的な前処理: 行ごとの argmax の前後3点に放物線を当ててピーク位置を補正
  - AI推論: しきい値を超えた区間の確率加重重心
で深さを求め、結果フォルダに次の2ファイルを置く。フロントはあればこれを使い、無ければ従来どおりPNGから求める。
  depth_grid.f32   : float32 リトルエンディアン、形状 [フレーム数, 画像の行数]、欠損は NaN
  depth_meta.json  : 形状・求め方・処理条件（アルゴリズム、CPU/GPU、しきい値、モデル、日時など）
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import numpy as np

DEPTH_GRID_NAME = "depth_grid.f32"
DEPTH_META_NAME = "depth_meta.json"

# 同じ行でこの画素数以下の隙間しか空いていない区間は1本の縞として結合する
# （フロントエンドの extractRowLayers の LAYER_MERGE_GAP_PX と揃える）
LAYER_MERGE_GAP_PX = 3


def subpixel_peak_depth(
    contrast: np.ndarray, max_indices: np.ndarray, peak_result: np.ndarray
) -> np.ndarray:
    """古典的な前処理の argmax を、前後3点の放物線近似でサブピクセルに補正した深さ [px]。

    位置の基準は従来のPNG重心と同じ「argmax − 0.5」（結果PNGは argmax と その左1px を塗るため）。
    基準を揃えておくことで、サブピクセル化しても深さ全体が1px近くずれることはない。
    ピークマスク等で最終的に消された行（peak_result の argmax 位置が 0）は NaN。
    """
    n, h, w = contrast.shape
    idx = max_indices.astype(np.int64)
    kept = np.take_along_axis(peak_result, idx[..., None], axis=2)[..., 0] > 0
    take = lambda i: np.take_along_axis(contrast, np.clip(i, 0, w - 1)[..., None], axis=2)[..., 0]
    c0 = take(idx).astype(np.float64)
    cm = take(idx - 1).astype(np.float64)
    cp = take(idx + 1).astype(np.float64)
    denom = cm - 2.0 * c0 + cp
    interior = (idx > 0) & (idx < w - 1) & (denom < 0)
    delta = np.zeros_like(c0)
    np.divide(0.5 * (cm - cp), denom, out=delta, where=interior)
    delta = np.clip(delta, -0.5, 0.5)
    depth = (idx - 0.5 + delta).astype(np.float32)
    depth[~kept] = np.nan
    return depth


def row_centroid_depth(
    mask: np.ndarray, weight: np.ndarray, merge_gap: int = LAYER_MERGE_GAP_PX
) -> np.ndarray:
    """二値マスクの行ごとに、縞が1本だけの行の重み付き重心 [px] を返す（2本以上・無しの行は NaN）。

    区間の分け方はフロントエンドと同じで、merge_gap 以下の隙間は同じ縞の途切れとみなして結合する。
    重心はしきい値を超えた画素だけで取り、重みに確率を使う（隙間の画素は含めない）。
    """
    h, w = mask.shape
    m = mask.astype(bool)
    d = np.diff(np.pad(m.astype(np.int8), ((0, 0), (1, 1))), axis=1)
    ys, starts = np.where(d == 1)
    _, ends = np.where(d == -1)  # 区間の終端（含まない）。行優先なので starts と同じ順
    out = np.full(h, np.nan, dtype=np.float32)
    if ys.size == 0:
        return out
    wm = np.where(m, weight, 0).astype(np.float64)
    cw = np.cumsum(np.pad(wm, ((0, 0), (1, 0))), axis=1)
    cx = np.cumsum(np.pad(wm * np.arange(w), ((0, 0), (1, 0))), axis=1)
    run_w = cw[ys, ends] - cw[ys, starts]
    run_x = cx[ys, ends] - cx[ys, starts]
    # 行が変わる or 前の区間との隙間が merge_gap を超えるところで新しい縞
    new = np.ones(ys.size, dtype=bool)
    new[1:] = (ys[1:] != ys[:-1]) | (starts[1:] - ends[:-1] > merge_gap)
    gid = np.cumsum(new) - 1
    g_w = np.bincount(gid, weights=run_w)
    g_x = np.bincount(gid, weights=run_x)
    g_row = ys[new]
    per_row = np.bincount(g_row, minlength=h)
    single = per_row[g_row] == 1
    ok = single & (g_w > 1e-9)
    out[g_row[ok]] = (g_x[ok] / g_w[ok]).astype(np.float32)
    return out


def build_meta(depth: Optional[np.ndarray], **info: Any) -> Dict[str, Any]:
    """depth_meta.json の中身。depth が None なら深さファイルなし（処理条件だけ記録する）"""
    meta: Dict[str, Any] = {
        "version": 1,
        "created_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "depth_grid": DEPTH_GRID_NAME if depth is not None else None,
        "shape": list(depth.shape) if depth is not None else None,
        "dtype": "float32-le",
    }
    meta.update({k: v for k, v in info.items() if v is not None})
    return meta


def encode(depth: Optional[np.ndarray], meta: Dict[str, Any]) -> Dict[str, bytes]:
    """書き出す（またはキャッシュに載せる）ファイル名→中身"""
    files = {DEPTH_META_NAME: json.dumps(meta, ensure_ascii=False, indent=2).encode()}
    if depth is not None:
        files[DEPTH_GRID_NAME] = np.ascontiguousarray(depth, dtype="<f4").tobytes()
    return files


def write(directory: str, depth: Optional[np.ndarray], meta: Dict[str, Any]) -> None:
    os.makedirs(directory, exist_ok=True)
    for name, data in encode(depth, meta).items():
        with open(os.path.join(directory, name), "wb") as f:
            f.write(data)
