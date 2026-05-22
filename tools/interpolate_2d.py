"""
2Dグリッド高さマップ(Keyence互換, -9999.9=欠損)を
列方向・行方向(スライス方向)の両方向で補間する。

段差マスタ_cropped.csv は 行=スライス, 列=各スライス画像内の縦軸 という並び。
列方向だけ補間する従来ツール(interpolate_scan.py / compare_spline_all.py)と違い、
スライス方向(行方向)も埋めて2D的に不自然のない結果を得る。

処理:
  1) 列方向スプライン補間   (各スライス画像内の縦軸)
  2) 行方向スプライン補間   (スライス方向 = z軸)
  3) 残る大穴を2D拡散補間   (周囲から滑らかに浸透させる)
  4) 補間セルのみ軽くガウシアン平滑化し境界をなじませる(--smooth指定時)

使い方:
  python tools/interpolate_2d.py input.csv output.csv \
      [--max-gap 12] [--smooth 0.8] [--png out.png]
"""
import argparse
import csv

import numpy as np
from scipy.interpolate import CubicSpline
from scipy.ndimage import gaussian_filter

MISSING = -9999.9


def load_csv(path):
    """ジャグド配列に対応してロード。明示的に値があったセルの present マスクも返す。"""
    rows = []
    with open(path) as f:
        for line in f:
            line = line.rstrip("\n").rstrip(",")
            if line == "":
                continue
            rows.append([float(v) for v in line.split(",")])
    w = max(len(r) for r in rows)
    arr = np.full((len(rows), w), MISSING)
    present = np.zeros((len(rows), w), dtype=bool)
    for i, r in enumerate(rows):
        arr[i, : len(r)] = r
        present[i, : len(r)] = True
    return arr, present


def find_gaps(mask):
    """mask(True=有効)の内側にある欠損区間 (start, end) を列挙。両端の欠損は除外。"""
    idx = np.where(mask)[0]
    if len(idx) < 2:
        return []
    gaps = []
    in_gap = False
    gs = 0
    for i in range(idx[0], idx[-1] + 1):
        if not mask[i]:
            if not in_gap:
                gs = i
                in_gap = True
        elif in_gap:
            gaps.append((gs, i - 1))
            in_gap = False
    return gaps


def _linear_fill(out, line, gs, ge):
    v0, v1 = line[gs - 1], line[ge + 1]
    span = (ge + 1) - (gs - 1)
    for i in range(gs, ge + 1):
        t = (i - (gs - 1)) / span
        out[i] = v0 + t * (v1 - v0)


def spline_line(line, max_gap):
    """1次元配列を欠損区間ごとに局所スプライン補間。max_gap超の穴は残す。"""
    out = line.copy()
    mask = line != MISSING
    idx = np.where(mask)[0]
    if len(idx) < 2:
        return out
    for gs, ge in find_gaps(mask):
        if ge - gs + 1 > max_gap:
            continue
        before = idx[idx < gs][-5:]
        after = idx[idx > ge][:5]
        loc = np.concatenate([before, after])
        if len(loc) < 4:
            _linear_fill(out, line, gs, ge)
            continue
        vals = line[loc]
        try:
            cs = CubicSpline(loc, vals, bc_type="natural")
            interp = cs(np.arange(gs, ge + 1))
            lo, hi = vals.min(), vals.max()
            margin = (hi - lo) * 0.3
            if np.all((interp >= lo - margin) & (interp <= hi + margin)):
                out[gs : ge + 1] = interp
            else:
                _linear_fill(out, line, gs, ge)
        except Exception:
            pass
    return out


def diffuse_fill(data, sigma=1.0, n_iter=4000, tol=1e-4):
    """残った欠損セルを反復ガウシアン拡散(Jacobi法)で埋める。観測セルは固定。"""
    known = data != MISSING
    if known.all() or not known.any():
        return data.copy()
    filled = data.copy()
    filled[~known] = data[known].mean()
    for _ in range(n_iter):
        sm = gaussian_filter(filled, sigma=sigma, mode="nearest")
        change = np.abs(sm[~known] - filled[~known]).max()
        filled[~known] = sm[~known]
        if change < tol:
            break
    return filled


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--max-gap", type=int, default=12,
                    help="スプライン補間する最大ギャップ長(行/列とも)")
    ap.add_argument("--smooth", type=float, default=0.0,
                    help="補間セルのみに掛けるガウシアン平滑化σ(0で無効)")
    ap.add_argument("--png", help="before/after比較画像の出力先")
    args = ap.parse_args()

    data, present = load_csv(args.input)
    orig_missing = data == MISSING
    n = data.size
    print(f"入力: {data.shape}, 有効率 {(~orig_missing).mean() * 100:.2f}%")

    res = data.copy()

    # 1) 列方向(各スライス画像内の縦軸)
    for c in range(res.shape[1]):
        res[:, c] = spline_line(res[:, c], args.max_gap)
    print(f"  列方向スプライン後 : 有効率 {(res != MISSING).mean() * 100:.2f}%")

    # 2) 行方向(スライス方向 = z軸)
    for r in range(res.shape[0]):
        res[r, :] = spline_line(res[r, :], args.max_gap)
    print(f"  行方向スプライン後 : 有効率 {(res != MISSING).mean() * 100:.2f}%")

    # 3) 残った大穴を2D拡散
    remaining = int((res == MISSING).sum())
    if remaining:
        res = diffuse_fill(res)
        print(f"  2D拡散後           : 有効率 {(res != MISSING).mean() * 100:.2f}% "
              f"(大穴 {remaining} セルを拡散補間)")

    # 4) 補間セルのみ平滑化
    if args.smooth > 0:
        sm = gaussian_filter(res, sigma=args.smooth, mode="nearest")
        filled_mask = orig_missing & present
        res[filled_mask] = sm[filled_mask]
        print(f"  補間セル平滑化     : σ={args.smooth}")

    # padding した非実在セルは欠損のまま戻す
    res[~present] = MISSING

    with open(args.output, "w", newline="") as f:
        w = csv.writer(f)
        for row in res:
            w.writerow([f"{v:.1f}" if v != MISSING else f"{MISSING}" for v in row])
    filled = int((orig_missing & present).sum())
    print(f"出力: {args.output}  ({filled} セルを補間)")

    if args.png:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        d0 = np.where(data == MISSING, np.nan, data)
        d1 = np.where(res == MISSING, np.nan, res)
        vmin = np.nanpercentile(d0, 1)
        vmax = np.nanpercentile(d0, 99)
        fig, axes = plt.subplots(2, 1, figsize=(12, 10))
        axes[0].imshow(d0, aspect="auto", cmap="viridis", vmin=vmin, vmax=vmax,
                       interpolation="nearest")
        axes[0].set_title(f"before  valid {(~orig_missing).mean() * 100:.1f}%")
        axes[1].imshow(d1, aspect="auto", cmap="viridis", vmin=vmin, vmax=vmax,
                       interpolation="nearest")
        axes[1].set_title(f"after 2D interpolation  valid {(res != MISSING).mean() * 100:.1f}%")
        for ax in axes:
            ax.set_xlabel("column (vertical axis within slice image)")
            ax.set_ylabel("row (slice index)")
        plt.tight_layout()
        plt.savefig(args.png, dpi=100)
        print(f"可視化: {args.png}")


if __name__ == "__main__":
    main()
