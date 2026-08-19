"""Keyence互換CSV（高さマップ, -9999.9=欠損）の品質を定量評価する.

CSV配列の対応（スライス再構成された高さマップの場合）:
  - 行（axis=0）= スライス方向（掃引方向）
  - 列（axis=1）= スライス画像内の空間方向

出力する指標（全体グリッド / 中央50%領域 の両方で算出）:
  - 有効率
  - 最大連続欠損幅（空間方向・スライス方向）
  - 欠損クラスタ数とサイズ（画像端接触=背景 / 内部ホールを区別）
  - 低密度ノイズ点率（周辺点密度ベース）・完全孤立点率

使い方:
    python tools/analyze_csv_quality.py file1.csv [file2.csv ...]

    # 中央窓を左に114列ずらす（被写体がグリッド中央より左にある場合）
    python tools/analyze_csv_quality.py file1.csv --col-shift -114
    # --col-shift 正=右/負=左, --row-shift 正=下/負=上
"""

import re
import sys

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import ndimage

MISSING_TH = -9000.0       # この値以下を欠損(-9999.9)とみなす
DENSITY_WIN = 5            # 周辺点密度を測る窓サイズ（奇数）
DENSITY_NOISE_TH = 0.30    # 窓内有効率がこの値未満の有効点を「低密度ノイズ点」とする


def _longest_run_along_axis(mask, axis):
    """2D bool配列の axis 方向の最長 True ラン長を、各ライン分の1D配列で返す。"""
    work = mask.T if axis == 0 else mask
    n_lines, length = work.shape
    best = np.zeros(n_lines, dtype=int)
    cur = np.zeros(n_lines, dtype=int)
    for j in range(length):
        cur = np.where(work[:, j], cur + 1, 0)
        best = np.maximum(best, cur)
    return best


def compute_metrics(valid):
    """有効マスク（bool 2D, True=有効）から欠損系指標を計算する。

    axis=1（行に沿う横方向）＝スライス画像内の空間方向、
    axis=0（列に沿う縦方向）＝スライス方向（掃引方向）。
    """
    missing = ~valid
    n_valid = int(valid.sum())
    m = {"shape": valid.shape, "n_cells": int(valid.size), "n_valid": n_valid,
         "valid_rate": float(valid.mean())}

    # --- 最大連続欠損幅 ---
    spatial_runs = _longest_run_along_axis(missing, axis=1)  # 空間方向
    slice_runs = _longest_run_along_axis(missing, axis=0)    # スライス方向
    m["max_run_spatial"] = int(spatial_runs.max())
    m["max_run_slice"] = int(slice_runs.max())
    m["mean_run_spatial"] = float(spatial_runs.mean())
    m["mean_run_slice"] = float(slice_runs.mean())

    # --- 欠損クラスタ（4近傍連結） ---
    labeled, n_clusters = ndimage.label(missing)
    m["n_clusters"] = int(n_clusters)
    interior_map = np.zeros(valid.shape, dtype=bool)
    if n_clusters > 0:
        counts = np.bincount(labeled.ravel(), minlength=n_clusters + 1)
        sizes = counts[1:]
        border = np.zeros(n_clusters + 1, dtype=bool)
        for edge in (labeled[0, :], labeled[-1, :], labeled[:, 0], labeled[:, -1]):
            border[np.unique(edge)] = True
        border[0] = False
        interior_labels = np.array(
            [lbl for lbl in range(1, n_clusters + 1) if not border[lbl]], dtype=int
        )
        interior_sizes = counts[interior_labels] if interior_labels.size else np.array([], int)
        m["max_cluster"] = int(sizes.max())
        m["n_interior"] = int(interior_labels.size)
        m["max_interior"] = int(interior_sizes.max()) if interior_sizes.size else 0
        m["mean_interior"] = float(interior_sizes.mean()) if interior_sizes.size else 0.0
        m["total_interior"] = int(interior_sizes.sum()) if interior_sizes.size else 0
        m["buckets"] = {
            "1px": int(np.count_nonzero(interior_sizes == 1)),
            "2-10px": int(np.count_nonzero((interior_sizes >= 2) & (interior_sizes <= 10))),
            "11-100px": int(np.count_nonzero((interior_sizes >= 11) & (interior_sizes <= 100))),
            ">100px": int(np.count_nonzero(interior_sizes > 100)),
        }
        if interior_labels.size:
            interior_map = np.isin(labeled, interior_labels)
    else:
        m.update(max_cluster=0, n_interior=0, max_interior=0, mean_interior=0.0,
                 total_interior=0, buckets={})

    # --- 周辺点密度ベースのノイズ ---
    density = ndimage.uniform_filter(
        valid.astype(np.float32), size=DENSITY_WIN, mode="constant", cval=0.0
    )
    noise_pts = valid & (density < DENSITY_NOISE_TH)
    m["n_noise"] = int(noise_pts.sum())
    m["noise_ratio"] = noise_pts.sum() / max(n_valid, 1)

    neighbor_count = ndimage.convolve(
        valid.astype(np.int16),
        np.array([[1, 1, 1], [1, 0, 1], [1, 1, 1]], dtype=np.int16),
        mode="constant", cval=0,
    )
    isolated = valid & (neighbor_count == 0)
    m["n_isolated"] = int(isolated.sum())
    m["isolated_ratio"] = isolated.sum() / max(n_valid, 1)

    return m, {"valid": valid, "interior_holes": interior_map, "noise": noise_pts}


def analyze(path, col_shift=0, row_shift=0):
    """1ファイルを全体グリッドと中央50%領域の両方で分析する。

    col_shift / row_shift で中央窓を平行移動できる（正=右/下, 負=左/上）。
    被写体がグリッド中央からずれている場合に窓を被写体へ寄せる用途。
    """
    data = np.loadtxt(path, delimiter=",")
    h, w = data.shape
    valid = data > MISSING_TH
    win_h, win_w = h // 2, w // 2
    r0 = min(max(h // 4 + row_shift, 0), h - win_h)
    c0 = min(max(w // 4 + col_shift, 0), w - win_w)
    r1, c1 = r0 + win_h, c0 + win_w
    full_m, full_maps = compute_metrics(valid)
    center_m, center_maps = compute_metrics(valid[r0:r1, c0:c1])
    return {
        "path": path, "shape": (h, w), "center_region": (r0, r1, c0, c1),
        "full": full_m, "center": center_m,
        "full_maps": full_maps, "center_maps": center_maps,
    }


def _short_name(path):
    base = path.split("/")[-1]
    # ファイル名に Ra等級(例 Ra0.05) があればそれをラベルにする（複数Raの比較用）
    m = re.search(r"Ra\d+(?:\.\d+)?", base)
    if m:
        tag = m.group(0)
        low = base.lower()
        if "cleaned" in low:
            tag += "(c)"
        elif "denoised" in low:
            tag += "(dn)"
        return tag
    p = path.lower()
    if "denoised" in p:
        return "denoised"
    if "cleaned" in p:
        return "cleaned"
    return base


def print_region_table(results, region_key, title):
    """指定リージョンの指標を比較表で出力する。"""
    names = [_short_name(r["path"]) for r in results]
    ms = [r[region_key] for r in results]
    col_w = 20

    print(f"\n【{title}】")

    def row(label, vals):
        cells = "".join(f"{v:>{col_w}}" for v in vals)
        print(f"  {label:<30}{cells}")

    row("指標", names)
    print("  " + "-" * (30 + col_w * len(names)))
    row("グリッドサイズ", [f"{m['shape'][0]}×{m['shape'][1]}" for m in ms])
    row("有効率", [f"{m['valid_rate'] * 100:.2f}%" for m in ms])
    row("有効セル数", [f"{m['n_valid']:,}" for m in ms])
    print("  " + "-" * (30 + col_w * len(names)))
    row("最大連続欠損幅（空間方向）", [f"{m['max_run_spatial']} px" for m in ms])
    row("最大連続欠損幅（スライス方向）", [f"{m['max_run_slice']} px" for m in ms])
    row("平均連続欠損幅（空間方向）", [f"{m['mean_run_spatial']:.1f} px" for m in ms])
    row("平均連続欠損幅（スライス方向）", [f"{m['mean_run_slice']:.1f} px" for m in ms])
    print("  " + "-" * (30 + col_w * len(names)))
    row("欠損クラスタ総数", [f"{m['n_clusters']:,}" for m in ms])
    row("最大クラスタサイズ", [f"{m['max_cluster']:,} px" for m in ms])
    row("内部ホール数（端非接触）", [f"{m['n_interior']:,}" for m in ms])
    row("最大内部ホールサイズ", [f"{m['max_interior']:,} px" for m in ms])
    row("内部ホール平均サイズ", [f"{m['mean_interior']:.1f} px" for m in ms])
    row("内部ホール総面積", [f"{m['total_interior']:,} px" for m in ms])
    for bucket in ("1px", "2-10px", "11-100px", ">100px"):
        row(f"  内部ホール {bucket}", [f"{m['buckets'].get(bucket, 0):,}" for m in ms])
    print("  " + "-" * (30 + col_w * len(names)))
    row(f"低密度ノイズ点（{DENSITY_WIN}×{DENSITY_WIN}窓<{DENSITY_NOISE_TH:.0%}）",
        [f"{m['n_noise']:,} ({m['noise_ratio'] * 100:.2f}%)" for m in ms])
    row("完全孤立点（8近傍0）",
        [f"{m['n_isolated']:,} ({m['isolated_ratio'] * 100:.2f}%)" for m in ms])


def print_report(results):
    print("=" * 78)
    print(" CSVデータ品質レポート")
    print("=" * 78)
    for r in results:
        r0, r1, c0, c1 = r["center_region"]
        print(f"  {r['path']}  グリッド {r['shape'][0]}×{r['shape'][1]}  "
              f"中央50%領域=行{r0}:{r1}×列{c0}:{c1}")
    print_region_table(results, "full", "全体グリッド")
    print_region_table(results, "center", "中央50%領域")
    print("=" * 78)


def save_visualization(results, region_key, out_path):
    """指定リージョンの 有効マスク・内部ホール・ノイズ点 を可視化する。"""
    n = len(results)
    fig, axes = plt.subplots(n, 3, figsize=(14, 3.2 * n), squeeze=False)
    for i, r in enumerate(results):
        m = r[region_key]
        mp = r[f"{region_key}_maps"]
        label = _short_name(r["path"])
        panels = [
            (mp["valid"], "valid mask", "gray"),
            (mp["interior_holes"], f"interior holes ({m['n_interior']})", "hot"),
            (mp["noise"], f"low-density noise pts ({m['n_noise']})", "hot"),
        ]
        for j, (ax, (arr, title, cmap)) in enumerate(zip(axes[i], panels)):
            ax.imshow(arr, cmap=cmap, aspect="auto", interpolation="nearest")
            ax.set_title(title, fontsize=8)
            ax.set_xticks([])
            ax.set_yticks([])
            if j == 0:
                ax.set_ylabel(label, fontsize=9)
    plt.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f"可視化を保存: {out_path}")


def main():
    args = sys.argv[1:]
    col_shift = row_shift = 0
    paths = []
    i = 0
    while i < len(args):
        if args[i] == "--col-shift":
            col_shift = int(args[i + 1]); i += 2
        elif args[i] == "--row-shift":
            row_shift = int(args[i + 1]); i += 2
        else:
            paths.append(args[i]); i += 1
    if not paths:
        print(__doc__)
        sys.exit(1)
    results = [analyze(p, col_shift, row_shift) for p in paths]
    print_report(results)
    save_visualization(results, "full", "out/csv_quality_analysis.png")
    save_visualization(results, "center", "out/csv_quality_analysis_center.png")


if __name__ == "__main__":
    main()
