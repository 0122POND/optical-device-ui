"""
古典画像処理による干渉縞検出。

パイプライン:
  CLAHE → bilateral filter → Frangi ridge → hysteresis threshold
  → skeletonize → 短い断片除去

Usage:
    # 1 枚処理 + 可視化
    python tools/detect_fringes_classical.py data/row_data/050.bmp \
        --out out/050_classical.png --compare data/mask_result/050_mask.png

    # ディレクトリ一括
    python tools/detect_fringes_classical.py data/row_data/ --out out/classical/
"""
import argparse
from pathlib import Path

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter
from skimage.filters import apply_hysteresis_threshold
from skimage.morphology import skeletonize, remove_small_objects


def preprocess(gray: np.ndarray) -> np.ndarray:
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(16, 16)).apply(gray)
    return cv2.bilateralFilter(clahe, d=7, sigmaColor=20, sigmaSpace=5)


def remove_horizontal_bg(img: np.ndarray, kx: int = 41) -> np.ndarray:
    """横方向に大きな平均を引いて、横縞背景を除去。"""
    f = img.astype(np.float32)
    bg = cv2.blur(f, (kx, 1))       # y 方向は平均しない、x 方向のみ幅広平均
    res = f - bg
    return res


def vertical_ridge(img: np.ndarray, sigmas: tuple) -> np.ndarray:
    """Hessian を使って「縦向きの明るい ridge」スコアをマルチスケールで計算。

    前処理で横縞背景を除去したあと、
    縦 ridge の中心では d²I/dx² が強く負、d²I/dy² は小。
    score = -Hxx × (1 - |Hyy|/(|Hxx|+ε))  × 縦方向に沿った coherence
    """
    # 横縞背景を削る（幅広 x 平均）
    residual = remove_horizontal_bg(img, kx=51)

    out = np.zeros_like(residual, dtype=np.float32)
    for s in sigmas:
        hxx = gaussian_filter(residual, sigma=s, order=(0, 2)) * (s ** 2)
        hyy = gaussian_filter(residual, sigma=s, order=(2, 0)) * (s ** 2)
        neg = np.clip(-hxx, 0, None)
        aniso = 1.0 - np.abs(hyy) / (np.abs(hxx) + 1e-6)
        aniso = np.clip(aniso, 0, 1)
        score = neg * aniso
        out = np.maximum(out, score)

    # 縦方向にスムージング（coherence 強調）
    out = gaussian_filter(out, sigma=(8.0, 0.0))
    return out


def detect(
    gray: np.ndarray,
    sigmas: tuple = (2.0, 3.0, 4.5),
    high_pct: float = 99.7,
    low_pct: float = 99.0,
    min_length: int = 60,
) -> dict:
    """古典パイプラインで縦方向 fringe を検出。中間結果を dict で返す。"""
    smooth = preprocess(gray)

    ridges = vertical_ridge(smooth, sigmas=sigmas)

    high = np.percentile(ridges, high_pct)
    low = np.percentile(ridges, low_pct)
    binary = apply_hysteresis_threshold(ridges, low, high)

    skel = skeletonize(binary)
    cleaned = remove_small_objects(skel, min_size=min_length, connectivity=2)

    return {
        "smooth": smooth,
        "ridges": ridges,
        "binary": binary,
        "skeleton": skel,
        "cleaned": cleaned,
    }


def metrics(pred: np.ndarray, gt: np.ndarray, tol: int = 2) -> dict:
    """薄線用の評価。通常 IoU + トレランス付き IoU（±tol px の shift 許容）。"""
    p = pred.astype(bool)
    g = gt.astype(bool)

    inter = (p & g).sum()
    union = (p | g).sum()
    iou = inter / union if union else 0.0
    dice = 2 * inter / (p.sum() + g.sum()) if (p.sum() + g.sum()) else 0.0

    # トレランス付き（膨張後の AND）
    k = 2 * tol + 1
    kernel = np.ones((k, k), np.uint8)
    p_d = cv2.dilate(p.astype(np.uint8), kernel)
    g_d = cv2.dilate(g.astype(np.uint8), kernel)
    tp_p = ((p & g_d.astype(bool)).sum()) / max(p.sum(), 1)   # precision (trans)
    tp_r = ((g & p_d.astype(bool)).sum()) / max(g.sum(), 1)   # recall    (trans)
    tol_f1 = 2 * tp_p * tp_r / (tp_p + tp_r) if (tp_p + tp_r) else 0.0

    return {
        "iou": iou,
        "dice": dice,
        "tol_precision": tp_p,
        "tol_recall": tp_r,
        "tol_f1": tol_f1,
        "pred_px": int(p.sum()),
        "gt_px": int(g.sum()),
    }


def save_debug(out_dir: Path, stem: str, r: dict, gt: np.ndarray | None) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    cv2.imwrite(str(out_dir / f"{stem}_smooth.png"), r["smooth"])

    rid = r["ridges"]
    rid_u8 = (255 * (rid - rid.min()) / max(rid.max() - rid.min(), 1e-9)).astype(np.uint8)
    cv2.imwrite(str(out_dir / f"{stem}_ridges.png"), rid_u8)

    cv2.imwrite(str(out_dir / f"{stem}_binary.png"), (r["binary"] * 255).astype(np.uint8))
    cv2.imwrite(str(out_dir / f"{stem}_mask.png"), (r["cleaned"] * 255).astype(np.uint8))

    # GT との重ね
    if gt is not None:
        overlay = cv2.cvtColor(r["smooth"], cv2.COLOR_GRAY2BGR)
        overlay[gt > 0] = (0, 255, 0)                    # GT = green
        overlay[r["cleaned"]] = (0, 0, 255)              # pred = red
        both = (gt > 0) & r["cleaned"]
        overlay[both] = (0, 255, 255)                    # both = yellow
        cv2.imwrite(str(out_dir / f"{stem}_overlay.png"), overlay)


def process_one(path: Path, gt_path: Path | None, out_dir: Path) -> dict | None:
    gray = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        print(f"[skip] 読み込み失敗: {path}")
        return None

    r = detect(gray)
    gt = cv2.imread(str(gt_path), cv2.IMREAD_GRAYSCALE) if gt_path and gt_path.exists() else None

    save_debug(out_dir, path.stem, r, gt)

    if gt is not None:
        m = metrics(r["cleaned"], gt > 0, tol=2)
        print(
            f"{path.name}: IoU={m['iou']:.3f}  Dice={m['dice']:.3f}  "
            f"tolF1(±2)={m['tol_f1']:.3f}  (pred={m['pred_px']} gt={m['gt_px']})"
        )
        return m

    print(f"{path.name}: saved (no GT)")
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="入力 bmp ファイル or ディレクトリ")
    ap.add_argument("--out", default="out/classical", help="出力ディレクトリ")
    ap.add_argument("--compare", help="単一入力時の GT マスクパス")
    ap.add_argument("--gt-dir", help="ディレクトリ入力時の GT マスクディレクトリ")
    args = ap.parse_args()

    inp = Path(args.input)
    out_dir = Path(args.out)

    if inp.is_file():
        gt = Path(args.compare) if args.compare else None
        process_one(inp, gt, out_dir)
        return 0

    # ディレクトリ
    files = sorted(inp.glob("*.bmp")) + sorted(inp.glob("*.png"))
    gt_dir = Path(args.gt_dir) if args.gt_dir else None
    results = []
    for f in files:
        gt_path = None
        if gt_dir:
            # 001.bmp → 001_mask.png を推定
            gt_path = gt_dir / f"{f.stem}_mask.png"
        m = process_one(f, gt_path, out_dir)
        if m:
            results.append(m)

    if results:
        avg = {k: np.mean([r[k] for r in results]) for k in ("iou", "dice", "tol_f1")}
        print(f"\n=== {len(results)} 枚平均 ===")
        print(f"IoU={avg['iou']:.3f}  Dice={avg['dice']:.3f}  tolF1(±2)={avg['tol_f1']:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
