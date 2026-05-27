"""
1〜8行ギャップを全てスプライン補間した場合と、
現行(1〜3:線形, 4〜8:スプライン)の差分を比較する。
"""
import csv
import numpy as np
from scipy.interpolate import CubicSpline

MISSING = -9999.9
MAX_GAP = 8  # 9行以上はスキップ


def load_csv(path):
    with open(path) as f:
        return np.array([[float(v) for v in r] for r in csv.reader(f)])


def find_gaps(mask):
    idx = np.where(mask)[0]
    if len(idx) < 2:
        return []
    first, last = idx[0], idx[-1]
    gaps = []
    in_gap = False
    gs = 0
    for i in range(first, last + 1):
        if not mask[i]:
            if not in_gap:
                gs = i
                in_gap = True
        else:
            if in_gap:
                gaps.append((gs, i - 1))
                in_gap = False
    if in_gap:
        gaps.append((gs, last))
    return gaps


def linear_fill(col, gs, ge):
    v0, v1 = col[gs - 1], col[ge + 1]
    for i in range(gs, ge + 1):
        t = (i - (gs - 1)) / ((ge + 1) - (gs - 1))
        col[i] = v0 + t * (v1 - v0)


def spline_fill(col, valid_idx, gs, ge):
    """局所スプライン補間 (±30%範囲チェック, 失敗時線形)"""
    before = valid_idx[valid_idx < gs][-5:]
    after = valid_idx[valid_idx > ge][:5]
    local = np.concatenate([before, after])
    if len(local) < 4:
        linear_fill(col, gs, ge)
        return "linear_fallback"
    vals = col[local]
    try:
        cs = CubicSpline(local, vals, bc_type="natural")
        interp = cs(np.arange(gs, ge + 1))
        lo, hi = vals.min(), vals.max()
        margin = (hi - lo) * 0.3
        if np.all((interp >= lo - margin) & (interp <= hi + margin)):
            col[gs:ge + 1] = interp
            return "spline"
        else:
            linear_fill(col, gs, ge)
            return "linear_fallback"
    except Exception:
        return "skip"


def interpolate(data, strategy):
    """strategy: 'hybrid' (現行) または 'all_spline'"""
    result = data.copy()
    counts = {"linear": 0, "spline": 0, "linear_fallback": 0, "skip": 0}
    for c in range(result.shape[1]):
        col = result[:, c]
        mask = col != MISSING
        idx = np.where(mask)[0]
        if len(idx) < 2:
            continue
        for gs, ge in find_gaps(mask):
            size = ge - gs + 1
            if size > MAX_GAP:
                counts["skip"] += size
                continue
            if strategy == "hybrid" and size <= 3:
                linear_fill(col, gs, ge)
                counts["linear"] += size
            else:
                r = spline_fill(col, idx, gs, ge)
                counts[r] += size
    return result, counts


def diff_stats(a, b, data):
    """両者で共に補間された(= 元欠損だが両方で埋まった)セルの差分統計"""
    orig_missing = data == MISSING
    a_filled = a != MISSING
    b_filled = b != MISSING
    common = orig_missing & a_filled & b_filled
    d = np.abs(a[common] - b[common])
    return {
        "n_cells": int(common.sum()),
        "mean_abs_diff": float(d.mean()) if d.size else 0,
        "max_abs_diff": float(d.max()) if d.size else 0,
        "median_abs_diff": float(np.median(d)) if d.size else 0,
        "p95_abs_diff": float(np.percentile(d, 95)) if d.size else 0,
    }


def main():
    path = "/Users/mkuronuma/Documents/optical-device-ui/50円玉裏面.csv"
    data = load_csv(path)
    print(f"入力: {data.shape}, 有効率 {(data!=MISSING).mean()*100:.2f}%\n")

    hybrid, c1 = interpolate(data, "hybrid")
    all_sp, c2 = interpolate(data, "all_spline")

    def vr(x):
        return (x != MISSING).mean() * 100

    print(f"{'':<22}{'hybrid(現行)':>18}{'all_spline':>18}")
    print(f"{'有効率':<22}{vr(hybrid):>17.2f}%{vr(all_sp):>17.2f}%")
    print(f"{'線形':<22}{c1['linear']:>18}{c2['linear']:>18}")
    print(f"{'スプライン':<22}{c1['spline']:>18}{c2['spline']:>18}")
    print(f"{'スプライン→線形F.B.':<18}{c1['linear_fallback']:>18}{c2['linear_fallback']:>18}")
    print(f"{'スキップ(9行以上)':<20}{c1['skip']:>18}{c2['skip']:>18}")

    # 値の範囲
    v1 = hybrid[hybrid != MISSING]
    v2 = all_sp[all_sp != MISSING]
    print(f"\n値域: hybrid [{v1.min():.1f}, {v1.max():.1f}]  all_spline [{v2.min():.1f}, {v2.max():.1f}]")
    print(f"平均: hybrid {v1.mean():.2f}  all_spline {v2.mean():.2f}")
    print(f"標準偏差: hybrid {v1.std():.2f}  all_spline {v2.std():.2f}")

    # 差分
    ds = diff_stats(hybrid, all_sp, data)
    print(f"\n--- 両者で埋められたセル({ds['n_cells']}個)の差分 ---")
    print(f"平均絶対差 : {ds['mean_abs_diff']:.4f}")
    print(f"中央値絶対差: {ds['median_abs_diff']:.4f}")
    print(f"95%点絶対差: {ds['p95_abs_diff']:.4f}")
    print(f"最大絶対差 : {ds['max_abs_diff']:.4f}")

    out = "/Users/mkuronuma/Documents/optical-device-ui/50円玉裏面_interpolated_all_spline.csv"
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        for row in all_sp:
            w.writerow([f"{v:.1f}" for v in row])
    print(f"\nSaved: {out}")


if __name__ == "__main__":
    main()
