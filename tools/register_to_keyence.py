"""
row_data 3D 復元と Keyence 高さマップを「10」文字の位置で 2D registration する。

手順:
  1. row_data の peak スタックから X-Y 平面の height map を作る（100µm グリッド）
  2. Keyence CSV を読み込み、必要に応じて X/Y 反転して向きを合わせる
  3. 両者で「10」文字部分（raised region）を閾値抽出
  4. 連結成分を 2 個取る → 各々の重心を control point に
  5. 2 対応点ペアから 2D 相似変換（tx, ty, scale）を fit
  6. row_data を Keyence 座標系に warp、overlap マスクを作る
  7. overlap 内部で height RMSE を計算

Usage:
    python tools/register_to_keyence.py  # row_data vs 10円表
"""
from __future__ import annotations
import sys
from pathlib import Path

import cv2
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from preprocessing_cpu import run_preprocess  # noqa: E402


PITCH_UM = 100.0       # 共通グリッドピッチ [µm]
UM_PER_PIX_SPATIAL = 20.0  # Infinicam row → X [µm]
UM_PER_PIX_DEPTH = 1.8     # Infinicam col → Z [µm]
FRAME_UM = 100.0       # row_data frame step [µm]
KEYENCE_FOV_UM = 10000.0   # Keyence FOV [µm]


def build_row_data_height_map(peak_stack: np.ndarray, pitch: float = PITCH_UM) -> tuple[np.ndarray, float, float]:
    """peak (N, H, W) から (Y_bins, X_bins) の height map を作成。Z は µm。"""
    n_frames, h_img, w_img = peak_stack.shape
    x_max_um = h_img * UM_PER_PIX_SPATIAL
    y_max_um = n_frames * FRAME_UM

    nx = int(np.ceil(x_max_um / pitch))
    ny = int(np.ceil(y_max_um / pitch))

    sum_z = np.zeros((ny, nx), dtype=np.float64)
    count = np.zeros((ny, nx), dtype=np.int32)

    for i in range(n_frames):
        rows, cols = np.where(peak_stack[i] > 0)
        if len(rows) == 0:
            continue
        X_um = rows * UM_PER_PIX_SPATIAL
        Z_um = cols * UM_PER_PIX_DEPTH
        xi = np.clip((X_um / pitch).astype(int), 0, nx - 1)
        yi = min(int(i * FRAME_UM / pitch), ny - 1)
        np.add.at(sum_z[yi], xi, Z_um)
        np.add.at(count[yi], xi, 1)

    H = np.where(count > 0, sum_z / np.maximum(count, 1), np.nan)
    return H, pitch, pitch


def build_keyence_height_map(csv_path: str, pitch: float = PITCH_UM) -> np.ndarray:
    """Keyence CSV を pitch µm グリッドにリサンプル。"""
    raw = np.loadtxt(csv_path, delimiter=",")
    raw[raw <= -9999] = np.nan
    rows, cols = raw.shape
    x_um_per_col = KEYENCE_FOV_UM / cols
    y_um_per_row = KEYENCE_FOV_UM / rows

    x_orig = np.arange(cols) * x_um_per_col
    y_orig = np.arange(rows) * y_um_per_row

    nx = int(np.ceil(cols * x_um_per_col / pitch))
    ny = int(np.ceil(rows * y_um_per_row / pitch))

    # バイリニア再サンプル（OpenCV 使用、NaN 対策で mask 併用）
    valid = (~np.isnan(raw)).astype(np.float32)
    filled = np.where(np.isnan(raw), 0, raw).astype(np.float32)
    new_size = (nx, ny)
    Z_resampled = cv2.resize(filled, new_size, interpolation=cv2.INTER_LINEAR)
    V_resampled = cv2.resize(valid, new_size, interpolation=cv2.INTER_LINEAR)
    H = np.where(V_resampled > 0.5, Z_resampled / np.maximum(V_resampled, 1e-6), np.nan)
    return H


def _detrend_height_map(H: np.ndarray, detrend_sigma_px: int = 30) -> np.ndarray:
    """大規模な Y/X 方向トレンド（装置ドリフト、コイン傾き）を除去。

    有効領域のみで median-filter 的な低周波成分を推定し、引き算。
    """
    valid = ~np.isnan(H)
    filled = np.where(valid, H, 0).astype(np.float32)
    w = valid.astype(np.float32)
    # 加重ガウスブラー
    ksize = max(3, detrend_sigma_px * 6 + 1)
    bg = cv2.GaussianBlur(filled * w, (ksize, ksize), detrend_sigma_px)
    bg_w = cv2.GaussianBlur(w, (ksize, ksize), detrend_sigma_px)
    bg_safe = np.where(bg_w > 0.01, bg / np.maximum(bg_w, 1e-6), 0)
    return H - bg_safe


def find_10_components(
    height_map: np.ndarray,
    raised_is_low: bool,
    detrend: bool = False,
    detrend_sigma_px: int = 30,
    thresh_percentile: float = 85.0,
) -> tuple[list[tuple[float, float]], np.ndarray, np.ndarray]:
    """height map から raised 領域を抽出して、「1」と「0」の 2 個の連結成分を取る。

    raised_is_low: True なら raised は Z が小さい側（row_data）、False なら大きい側（Keyence）
    detrend: True なら低周波トレンドを除去してから閾値
    thresh_percentile: detrend 後の raised パーセンタイル（上位何%を raised とみなすか）
    戻り値: (重心 [(x, y) in px], ラベル画像, 使用した binary mask)
    """
    valid = ~np.isnan(height_map)
    if not valid.any():
        return [], np.zeros_like(height_map, dtype=np.int32), np.zeros_like(height_map, dtype=np.uint8)

    H = height_map.copy()
    if detrend:
        H = _detrend_height_map(H, detrend_sigma_px)

    # raised 方向を +1 にそろえて符号統一
    signed = (-H) if raised_is_low else H

    # 有効領域のパーセンタイル閾値
    vals = signed[valid]
    thresh = np.percentile(vals, thresh_percentile)
    binary = ((signed >= thresh) & valid).astype(np.uint8) * 255

    # Morphological opening/closing で整形
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    # 連結成分
    n, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
    comps = sorted(range(1, n), key=lambda k: -stats[k, cv2.CC_STAT_AREA])
    min_area = max(30, 0.005 * height_map.size)
    top = [k for k in comps if stats[k, cv2.CC_STAT_AREA] >= min_area][:2]
    cents = [(centroids[k, 0], centroids[k, 1]) for k in top]
    cents_sorted = sorted(cents, key=lambda c: c[0])
    label_img = np.zeros_like(labels, dtype=np.int32)
    for i, k in enumerate(top):
        label_img[labels == k] = i + 1
    return cents_sorted, label_img, binary


def template_match_registration(
    H_src: np.ndarray,
    H_tmpl: np.ndarray,
    raised_is_low_src: bool,
    raised_is_low_tmpl: bool,
    angles_deg: tuple = (-90, -45, 0, 45, 90, 135, 180),
    scales: tuple = (0.9, 1.0, 1.1),
    detrend_src_sigma: int = 25,
) -> dict:
    """テンプレート H_tmpl が H_src のどこに最もマッチするか、回転・スケール・平行移動で探索。

    両方 detrend し、raised が +方向になるよう符号をそろえる。NCC ベース。
    戻り値: {'affine': 2x3 matrix, 'score', 'angle', 'scale', 'tx', 'ty'}
    """
    def to_response(H: np.ndarray, raised_is_low: bool, detrend_sigma: int) -> np.ndarray:
        valid = ~np.isnan(H)
        Hd = _detrend_height_map(H, detrend_sigma) if detrend_sigma > 0 else H.copy()
        Hd = np.where(valid, Hd, 0)
        if raised_is_low:
            Hd = -Hd
        # ラディアン内で 0..1 に正規化
        if Hd.std() > 0:
            Hd = (Hd - Hd.mean()) / Hd.std()
        return Hd.astype(np.float32), valid.astype(np.float32)

    src, src_valid = to_response(H_src, raised_is_low_src, detrend_src_sigma)
    tmpl_all, tmpl_valid = to_response(H_tmpl, raised_is_low_tmpl, 0)

    best = {"score": -1e9}
    sh, sw = src.shape

    for ang in angles_deg:
        for s in scales:
            # テンプレートを回転＋スケール
            th, tw = tmpl_all.shape
            M = cv2.getRotationMatrix2D((tw / 2, th / 2), ang, s)
            cos_a, sin_a = abs(M[0, 0]), abs(M[0, 1])
            new_w = int(th * sin_a + tw * cos_a)
            new_h = int(th * cos_a + tw * sin_a)
            M[0, 2] += (new_w - tw) / 2
            M[1, 2] += (new_h - th) / 2
            T = cv2.warpAffine(tmpl_all, M, (new_w, new_h), flags=cv2.INTER_LINEAR, borderValue=0)
            Tv = cv2.warpAffine(tmpl_valid, M, (new_w, new_h), flags=cv2.INTER_LINEAR, borderValue=0)
            if new_h >= sh or new_w >= sw:
                continue
            # NCC（有効画素重み付きは matchTemplate ではできないので、mask で簡易対応）
            # テンプレートを有効領域で正規化して再設定
            mask = (Tv > 0.5).astype(np.uint8)
            if mask.sum() < 30:
                continue
            res = cv2.matchTemplate(src, T, cv2.TM_CCOEFF_NORMED, mask=mask.astype(np.float32))
            # cv2 の出力に NaN/inf があれば除外
            if not np.isfinite(res).any():
                continue
            res = np.where(np.isfinite(res), res, -1e9)
            maxv = float(res.max())
            my, mx = np.unravel_index(res.argmax(), res.shape)
            if maxv > best["score"]:
                # affine 合成: tmpl → rotated/scaled tmpl → translate to (mx, my)
                # テンプレート中心 (tw/2, th/2) → 回転後 (new_w/2, new_h/2) → 平行移動 → src 内の位置
                # 結果: src 座標で tmpl の位置は (mx, my) + (new_w/2, new_h/2)
                # つまり tmpl の中心が src の (mx + new_w/2, my + new_h/2) にマップされる
                M_full = M.copy()
                M_full[0, 2] += mx
                M_full[1, 2] += my
                best = {
                    "score": maxv,
                    "angle": float(ang),
                    "scale": float(s),
                    "tx": int(mx),
                    "ty": int(my),
                    "affine_tmpl_to_src": M_full,
                    "new_w": new_w,
                    "new_h": new_h,
                }
    return best


def solve_similarity(src: list[tuple[float, float]], dst: list[tuple[float, float]]) -> np.ndarray | None:
    """2 点対応から相似変換 (scale, rotation, tx, ty) を求める。

    戻り値: 2x3 アフィン行列 or None
    """
    if len(src) != 2 or len(dst) != 2:
        return None
    src_np = np.array(src, dtype=np.float64)
    dst_np = np.array(dst, dtype=np.float64)
    # 2 点相似変換: src → dst = s*R*src + t
    v_src = src_np[1] - src_np[0]
    v_dst = dst_np[1] - dst_np[0]
    scale = np.linalg.norm(v_dst) / max(np.linalg.norm(v_src), 1e-9)
    theta = np.arctan2(v_dst[1], v_dst[0]) - np.arctan2(v_src[1], v_src[0])
    c, s = np.cos(theta), np.sin(theta)
    R = np.array([[c, -s], [s, c]]) * scale
    t = dst_np[0] - R @ src_np[0]
    return np.hstack([R, t.reshape(2, 1)])


def _fill_small_nan(H: np.ndarray, max_iter: int = 3) -> np.ndarray:
    """NaN を近傍平均で埋める（小さい穴のみ）。"""
    out = H.copy()
    for _ in range(max_iter):
        nan_mask = np.isnan(out)
        if not nan_mask.any():
            break
        filled = np.where(nan_mask, 0, out).astype(np.float32)
        valid = (~nan_mask).astype(np.float32)
        kernel = np.ones((3, 3), np.float32)
        sum_z = cv2.filter2D(filled, -1, kernel)
        sum_v = cv2.filter2D(valid, -1, kernel)
        avg = np.where(sum_v > 0, sum_z / np.maximum(sum_v, 1e-6), np.nan)
        out = np.where(nan_mask, avg, out)
    return out


def warp_height_map(H_src: np.ndarray, affine: np.ndarray, dst_shape: tuple[int, int]) -> np.ndarray:
    """height map を affine で warp。NaN 維持。"""
    H_filled = _fill_small_nan(H_src, max_iter=3)
    valid = (~np.isnan(H_filled)).astype(np.float32)
    filled = np.where(np.isnan(H_filled), 0, H_filled).astype(np.float32)
    Z = cv2.warpAffine(filled, affine, (dst_shape[1], dst_shape[0]), flags=cv2.INTER_LINEAR,
                       borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    # validity は NEAREST で warp して 0/1 保持
    V = cv2.warpAffine(valid, affine, (dst_shape[1], dst_shape[0]), flags=cv2.INTER_NEAREST,
                       borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    out = np.where(V > 0.5, Z, np.nan)
    return out


def evaluate_overlap(H_pred_warped: np.ndarray, H_gt: np.ndarray, detrend_sigma: int = 20) -> dict:
    """両 height map を detrend してからオーバーラップ領域で RMSE と相関を計算。

    row_data の大きな傾き（装置ドリフト・コイン傾斜）を除去し、
    コイン上の「彫刻による細かい Z 変化」同士で比較する。
    """
    # 両方 detrend
    pred_d = _detrend_height_map(H_pred_warped, detrend_sigma)
    gt_d = _detrend_height_map(H_gt, detrend_sigma)

    valid = ~np.isnan(pred_d) & ~np.isnan(gt_d)
    if valid.sum() < 50:
        return {"n": int(valid.sum())}

    pred = pred_d[valid].astype(np.float64)
    gt = gt_d[valid].astype(np.float64)

    # 符号補正（row_data は raised が Z 小、Keyence は raised が Z 大）
    sign = np.sign(np.cov(pred, gt)[0, 1]) or 1
    pred = sign * pred

    # Amplitude 正規化（MAD 基準）
    pred_mad = 1.4826 * np.median(np.abs(pred - np.median(pred))) + 1e-9
    gt_mad = 1.4826 * np.median(np.abs(gt - np.median(gt))) + 1e-9
    scale_factor = gt_mad / pred_mad
    pred_scaled = (pred - np.median(pred)) * scale_factor + np.median(gt)

    diff = pred_scaled - gt
    rmse = float(np.sqrt(np.mean(diff ** 2)))
    mae = float(np.mean(np.abs(diff)))
    pear = float(np.corrcoef(pred_scaled, gt)[0, 1])
    abs_err = np.abs(diff)
    thr = np.quantile(abs_err, 0.9)
    trimmed_rmse = float(np.sqrt(np.mean(diff[abs_err <= thr] ** 2)))

    return {
        "n": int(valid.sum()),
        "rmse": rmse, "mae": mae, "pearson": pear, "trimmed_rmse_90": trimmed_rmse,
        "sign_applied": int(sign),
        "scale_pred_to_gt": float(scale_factor),
        "pred_mad_um": float(pred_mad),
        "gt_mad_um": float(gt_mad),
    }


def main() -> int:
    out_dir = ROOT / "out" / "registration"
    out_dir.mkdir(parents=True, exist_ok=True)

    print("[1] row_data を preprocessing…")
    out = run_preprocess(peak_mode="argmax")
    pk = np.pad(out["peak_data"], ((0, 0), (0, 0), (0, 1)))

    print("[2] row_data の 3D height map を構築…")
    H_row, _, _ = build_row_data_height_map(pk)
    print(f"    shape={H_row.shape}  valid={(~np.isnan(H_row)).mean()*100:.1f}%  "
          f"Z=[{np.nanmin(H_row):.0f}, {np.nanmax(H_row):.0f}] µm")

    print("[3] Keyence height map を構築…")
    H_key = build_keyence_height_map(str(ROOT / "data/surface_keyence/260128_155315_10円玉_表.csv"))
    print(f"    shape={H_key.shape}  valid={(~np.isnan(H_key)).mean()*100:.1f}%  "
          f"Z=[{np.nanmin(H_key):.0f}, {np.nanmax(H_key):.0f}] µm")

    print("[4] 手動 anchor 点で相似変換を解く…")
    # 目視での位置読み取り（row_data detrend 画像から）と Keyence 自動検出結果
    # 座標は (x, y) in 100µm grid pixel
    row_anchors = [(62.0, 30.0), (97.0, 30.0)]  # 「1」「0」 in row_data
    # Keyence は auto 検出
    _, _, bin_key_dbg = find_10_components(H_key, raised_is_low=False, thresh_percentile=70.0)
    cents_key, _, _ = find_10_components(H_key, raised_is_low=False, thresh_percentile=70.0)
    if len(cents_key) != 2:
        print(f"    Keyence の「10」自動検出に失敗 (n={len(cents_key)})")
        return 1
    key_anchors = list(cents_key)  # (x, y) ソート済み
    print(f"    row_data anchors: {row_anchors}")
    print(f"    Keyence  anchors: {key_anchors}")

    # src=row_data, dst=Keyence で相似変換 (M_row_to_key)
    M_row_to_key = solve_similarity(row_anchors, key_anchors)
    # warpAffine は dst→src マップを要求するので逆変換
    M_key_to_row = cv2.invertAffineTransform(M_row_to_key)
    print(f"    M_row_to_key =\n{M_row_to_key}")

    print("[5] row_data を Keyence 座標系へ warp…")
    H_row_warped = warp_height_map(H_row, M_key_to_row, H_key.shape)
    result = {"angle": 0, "scale": 0, "tx": 0, "ty": 0, "score": 0, "new_w": 0, "new_h": 0}

    # デバッグ保存（テンプレートマッチ結果の可視化）
    fig, axes = plt.subplots(2, 2, figsize=(14, 11))
    axes[0, 0].imshow(H_row, origin="lower", cmap="viridis")
    # マッチした Keyence の位置を矩形で示す
    nw, nh = result["new_w"], result["new_h"]
    tx, ty = result["tx"], result["ty"]
    rect = plt.Rectangle((tx, ty), nw, nh, fill=False, edgecolor="red", linewidth=2)
    axes[0, 0].add_patch(rect)
    axes[0, 0].set_title(f"row_data H (matched region, score={result['score']:.3f})")
    axes[0, 1].imshow(H_key, origin="lower", cmap="viridis")
    axes[0, 1].set_title("Keyence H (template)")
    axes[1, 0].imshow(H_row_warped, origin="lower", cmap="viridis")
    axes[1, 0].set_title("row_data warped to Keyence coord")
    axes[1, 1].axis("off")
    txt = f"angle: {result['angle']}°\nscale: {result['scale']}\ntx, ty: {result['tx']}, {result['ty']}\nNCC score: {result['score']:.3f}"
    axes[1, 1].text(0.05, 0.5, txt, fontsize=12, family="monospace")
    plt.tight_layout(); plt.savefig(out_dir / "debug_components.png", dpi=110)
    print(f"    → saved {out_dir/'debug_components.png'}")

    print("[7] オーバーラップ評価…")
    m = evaluate_overlap(H_row_warped, H_key)
    print(f"    overlap pixels={m.get('n')}")
    if "rmse" in m:
        print(f"    RMSE={m['rmse']:.1f}µm  trimmed RMSE(90)={m['trimmed_rmse_90']:.1f}µm  "
              f"MAE={m['mae']:.1f}µm  Pearson r={m['pearson']:.3f}  sign={m['sign_applied']}")

    # 可視化
    fig, axes = plt.subplots(2, 3, figsize=(16, 10))
    axes[0, 0].imshow(H_row, origin="lower", cmap="viridis")
    for x, y in row_anchors:
        axes[0, 0].plot(x, y, "r+", markersize=18, markeredgewidth=3)
    axes[0, 0].set_title("row_data H (manual anchors)")

    axes[0, 1].imshow(H_key, origin="lower", cmap="viridis")
    for x, y in key_anchors:
        axes[0, 1].plot(x, y, "r+", markersize=18, markeredgewidth=3)
    axes[0, 1].set_title("Keyence H (auto anchors)")

    axes[0, 2].imshow(H_row_warped, origin="lower", cmap="viridis")
    axes[0, 2].set_title("row_data warped → Keyence coord")

    valid = ~np.isnan(H_row_warped) & ~np.isnan(H_key)
    overlap_vis = np.where(valid, 1, 0)
    axes[1, 0].imshow(overlap_vis, origin="lower", cmap="gray")
    axes[1, 0].set_title(f"Overlap mask (n={m.get('n', 0)})")

    # 差分画像（両方 detrend, 符号・スケール補正済み）
    if "rmse" in m:
        sign = m["sign_applied"]
        scale = m.get("scale_pred_to_gt", 1.0)
        pred_d = _detrend_height_map(H_row_warped, 20)
        gt_d = _detrend_height_map(H_key, 20)
        pred_adj = sign * pred_d
        pred_adj = (pred_adj - np.nanmedian(pred_adj)) * scale + np.nanmedian(gt_d)
        diff = pred_adj - gt_d
        diff_vis = np.where(valid, diff, np.nan)
        v = float(np.nanquantile(np.abs(diff_vis), 0.95))
        axes[1, 1].imshow(diff_vis, origin="lower", cmap="coolwarm", vmin=-v, vmax=v)
        axes[1, 1].set_title(f"Residual (detrended)  RMSE={m['rmse']:.1f}µm  r={m['pearson']:.2f}")
        plt.colorbar(axes[1, 1].images[0], ax=axes[1, 1], label="residual [µm]")

        # 並列に detrended pred と gt も表示したい → axes[0,2] を再利用
        axes[0, 2].clear()
        vg = np.nanquantile(np.abs(gt_d), 0.95)
        axes[0, 2].imshow(np.where(valid, gt_d, np.nan), origin="lower", cmap="RdBu_r", vmin=-vg, vmax=vg)
        axes[0, 2].set_title("Keyence detrended (GT)")

    axes[1, 2].axis("off")
    axes[1, 2].text(0.05, 0.9, "Metrics", fontsize=12, weight="bold")
    y = 0.8
    for k, v in m.items():
        axes[1, 2].text(0.05, y, f"{k}: {v:.3f}" if isinstance(v, float) else f"{k}: {v}", fontsize=11)
        y -= 0.08

    plt.tight_layout()
    plt.savefig(out_dir / "registration_result.png", dpi=120, bbox_inches="tight")
    print(f"    -> saved {out_dir/'registration_result.png'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
