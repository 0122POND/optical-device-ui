"""支配的な面（RANSAC平面）を基準にしたノイズ除去.

Keyence互換CSV（高さマップ, -9999.9=欠損）の各有効セルを点 (x=列, y=行, z=高さ)
とみなし、RANSACで支配的な平面を推定する。平面の法線方向の符号付き距離ヒストグラム
から支配ピーク（=コイン表面の密な山）を求め、その山の谷（密度しきい値割れ）から外れた
点（=支配面から大きく離れた低密度のノイズ）を除去する。

使い方:
    python tools/denoise_dominant_plane.py input.csv [output.csv] [--mode all-peaks|dominant]

  --mode all-peaks : 検出された全ピーク帯域を保持し、外側の低密度ノイズのみ除去（既定）
  --mode dominant  : 最大ピークの山のみ保持。本体から分離した別クラスタ（縞ノイズ等）も除去
"""

import sys

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks

MISSING = -9999.9

# --- パラメータ（高さ値の単位は入力CSVの単位に準拠） ---
DIST_THRESHOLD = 15.0      # RANSACインライア判定の平面距離しきい値
RANSAC_N_ITER = 2000       # RANSAC反復回数
BIN_WIDTH = 1.0            # ヒストグラムのビン幅
SMOOTH_SIGMA = 2.0         # ヒストグラム平滑化のガウシアンσ
PEAK_HEIGHT_FRAC = 0.005   # 表示用ピーク検出の最小高さ（全点数に対する割合）
PEAK_DISTANCE = 3          # ピーク間最小距離（ビン数）
VALLEY_FRAC = 0.05         # 支配ピーク高さに対する谷判定しきい値（この割合を割れたら山の端）
SEED = 42


def fit_plane_ransac(pts, dist_thresh, n_iter, seed):
    """RANSACで支配的な平面 ax+by+cz+d=0 を推定する（normalは単位ベクトル）。"""
    rng = np.random.default_rng(seed)
    n = len(pts)
    best_inliers = -1
    best_plane = None
    for _ in range(n_iter):
        idx = rng.choice(n, 3, replace=False)
        p0, p1, p2 = pts[idx]
        normal = np.cross(p1 - p0, p2 - p0)
        norm = np.linalg.norm(normal)
        if norm < 1e-9:
            continue
        normal = normal / norm
        d = -float(normal @ p0)
        dist = np.abs(pts @ normal + d)
        inliers = int(np.count_nonzero(dist < dist_thresh))
        if inliers > best_inliers:
            best_inliers = inliers
            best_plane = (normal[0], normal[1], normal[2], d)
    return best_plane, best_inliers


def main():
    args = sys.argv[1:]
    keep_mode = "all-peaks"
    if "--mode" in args:
        i = args.index("--mode")
        keep_mode = args[i + 1]
        del args[i:i + 2]
    if not args or keep_mode not in ("all-peaks", "dominant"):
        print(__doc__)
        sys.exit(1)
    in_path = args[0]
    out_path = args[1] if len(args) > 1 else in_path.replace(".csv", "_denoised.csv")
    print(f"Keep mode: {keep_mode}")

    # --- 1. CSV高さマップ -> 3D点群 ---
    data = np.loadtxt(in_path, delimiter=",")
    valid = data > -9000
    rows, cols = np.where(valid)
    zs = data[valid]
    points = np.column_stack([cols, rows, zs]).astype(np.float64)
    print(f"Grid: {data.shape}, valid cells: {len(points):,} ({100 * len(points) / data.size:.2f}%)")

    # --- 2. RANSAC平面推定 ---
    plane_model, n_inliers = fit_plane_ransac(points, DIST_THRESHOLD, RANSAC_N_ITER, SEED)
    a, b, c, d = plane_model
    print(f"Estimated plane: a={a:.4f} b={b:.4f} c={c:.4f} d={d:.2f}")
    print(f"  inliers within {DIST_THRESHOLD}: {n_inliers:,} ({100 * n_inliers / len(points):.1f}%)")

    # --- 3. 支配面からの符号付き距離（plane=0） ---
    distances = points @ np.array([a, b, c]) + d

    bins = np.arange(distances.min() - 1, distances.max() + 1 + BIN_WIDTH, BIN_WIDTH)
    hist, bin_edges = np.histogram(distances, bins=bins)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
    hist_smooth = gaussian_filter1d(hist.astype(float), sigma=SMOOTH_SIGMA)

    # --- 表示用ピーク検出 ---
    peaks, _ = find_peaks(
        hist_smooth,
        height=len(points) * PEAK_HEIGHT_FRAC,
        distance=PEAK_DISTANCE,
    )
    print(f"Distribution peaks (>{PEAK_HEIGHT_FRAC * 100:.1f}% height): {len(peaks)}")
    for i, p in enumerate(peaks):
        print(f"  Peak {i}: dist={bin_centers[p]:.2f}, height={hist_smooth[p]:.0f}")

    if len(peaks) == 0:
        print("ピークが検出できませんでした。パラメータを調整してください。")
        sys.exit(1)

    # --- 4. ピーク帯域を密度しきい値（谷）で確定 ---
    # 検出された実ピーク群を1つの帯域とみなし、両端のピークから外向きに谷まで歩く。
    # クラスタ間の内部ギャップ（コインの段差など）は帯域内に残し、外側の低密度ノイズだけ落とす。
    dom = peaks[int(np.argmax(hist_smooth[peaks]))]   # 最も高いピーク = 支配面
    dom_height = hist_smooth[dom]
    valley_thresh = dom_height * VALLEY_FRAC
    print(f"Dominant peak: dist={bin_centers[dom]:.2f}, height={dom_height:.0f}")
    print(f"Valley threshold: {valley_thresh:.0f} ({VALLEY_FRAC * 100:.0f}% of dominant peak)")

    # keep_mode で山の起点を切替:
    #   all-peaks = 両端の実ピークから外向きに歩く（全ピーク帯域を保持）
    #   dominant  = 最大ピークから歩く（分離した別クラスタは帯域外＝除去）
    if keep_mode == "dominant":
        start_lo = start_hi = dom
    else:
        start_lo, start_hi = int(peaks.min()), int(peaks.max())

    lo = start_lo
    while lo > 0 and hist_smooth[lo] >= valley_thresh:
        lo -= 1
    hi = start_hi
    while hi < len(hist_smooth) - 1 and hist_smooth[hi] >= valley_thresh:
        hi += 1
    inner_limit = bin_centers[lo]
    outer_limit = bin_centers[hi]

    # --- ヒストグラム描画 ---
    fig, ax = plt.subplots(figsize=(11, 4))
    ax.bar(bin_centers, hist, width=BIN_WIDTH, alpha=0.4, label="Raw data")
    ax.plot(bin_centers, hist_smooth, "r-", linewidth=1.5, label="Smoothed")
    ax.scatter(bin_centers[peaks], hist_smooth[peaks], color="green", zorder=5, s=25, label="Peaks")
    ax.axhline(valley_thresh, color="orange", linestyle="--", linewidth=1,
               label=f"Valley threshold: {valley_thresh:.0f}")
    ax.axvline(inner_limit, color="blue", linestyle=":", linewidth=1.5,
               label=f"Inner cut: {inner_limit:.1f}")
    ax.axvline(outer_limit, color="blue", linestyle=":", linewidth=1.5,
               label=f"Outer cut: {outer_limit:.1f}")
    ax.axvspan(inner_limit, outer_limit, alpha=0.08, color="green")
    ax.axvline(0, color="black", linestyle="-", linewidth=1, alpha=0.5, label="Dominant plane (0)")
    ax.set_xlabel("Signed distance from dominant plane")
    ax.set_ylabel("Number of points")
    ax.set_title("Point distribution along plane normal (dominant plane = 0)")
    ax.legend(fontsize=8)
    plt.tight_layout()
    hist_png = "out/dominant_plane_histogram.png"
    fig.savefig(hist_png, dpi=150)
    print(f"Histogram saved: {hist_png}")

    # --- 5. 山の外（ノイズ）をカット ---
    print(f"Keep range: {inner_limit:.2f} - {outer_limit:.2f}")
    keep_mask = (distances >= inner_limit) & (distances <= outer_limit)
    removed = len(points) - int(keep_mask.sum())
    print(f"After range cut: {int(keep_mask.sum()):,} (removed: {removed:,}, "
          f"{100 * removed / len(points):.2f}%)")

    # --- 6. クリーンな高さマップを保存 ---
    cleaned = np.full_like(data, MISSING)
    kr, kc = rows[keep_mask], cols[keep_mask]
    cleaned[kr, kc] = data[kr, kc]
    np.savetxt(out_path, cleaned, delimiter=",", fmt="%.1f")
    print(f"Cleaned CSV saved: {out_path}")

    # --- before/after 可視化 ---
    before = np.where(valid, data, np.nan)
    after = np.where(cleaned > -9000, cleaned, np.nan)
    removed_map = np.where(valid & (cleaned <= -9000), data, np.nan)
    vmin, vmax = np.nanpercentile(before, [1, 99])

    fig2, axes = plt.subplots(3, 1, figsize=(12, 7))
    for ax_i, (arr, title, cmap, lo_v, hi_v) in zip(axes, [
        (before, f"Before ({np.isfinite(before).sum():,} cells)", "viridis", vmin, vmax),
        (after, f"After denoise ({np.isfinite(after).sum():,} cells)", "viridis", vmin, vmax),
        (removed_map, f"Removed noise ({np.isfinite(removed_map).sum():,} cells)", "inferno", None, None),
    ]):
        im = ax_i.imshow(arr, cmap=cmap, vmin=lo_v, vmax=hi_v, aspect="auto")
        ax_i.set_title(title, fontsize=9)
        fig2.colorbar(im, ax=ax_i, shrink=0.9)
    plt.tight_layout()
    cmp_png = "out/dominant_plane_before_after.png"
    fig2.savefig(cmp_png, dpi=150)
    print(f"Comparison saved: {cmp_png}")


if __name__ == "__main__":
    main()
