"""
干渉縞マスク画像群の欠損補間 + スライス間平滑化。

1. 各マスク画像の行ごとに白ピクセルのX座標重心を検出
2. 欠損行をスプライン補間で埋める
3. スライス間方向にガウシアン平滑化（時間的連続性を保証）
4. 指定範囲（10mm×10mm等）にクロップして出力

Usage:
    # 基本（補間のみ）
    python interpolate_masks.py data/mask_result/ data/output/

    # 10mm×10mm範囲 + スライス間平滑化
    python interpolate_masks.py data/mask_result/ data/output/ \
        --spatial-mm 10 --sweep-mm 10 --sweep-interval-um 100 --smooth-sigma 2

    # GIF出力付き
    python interpolate_masks.py data/mask_result/ data/output/ \
        --spatial-mm 10 --sweep-mm 10 --sweep-interval-um 100 --smooth-sigma 2 --gif
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import interpolate, ndimage


# Infinicamのデフォルトスケール
DEFAULT_UM_PER_PIX_DEPTH = 1.8   # X軸 (深さ方向)
DEFAULT_UM_PER_PIX_SPATIAL = 20  # Y軸 (空間方向)


def extract_profile(img: np.ndarray, y_start: int, y_end: int) -> dict:
    """画像から行ごとの白ピクセルX座標重心を抽出"""
    positions = {}
    for y in range(y_start, y_end):
        cols = np.where(img[y, :] > 128)[0]
        if len(cols) > 0:
            positions[y] = float(np.mean(cols))
    return positions


def interpolate_profile(positions: dict, y_start: int, y_end: int) -> dict:
    """検出済みの点をスプライン補間して欠損行を埋める"""
    if len(positions) < 2:
        return positions

    known_rows = sorted(positions.keys())
    known_xs = [positions[r] for r in known_rows]

    r_min, r_max = known_rows[0], known_rows[-1]
    k = min(3, len(known_rows) - 1)

    try:
        spline = interpolate.UnivariateSpline(
            known_rows, known_xs, k=k, s=len(known_rows) * 2
        )
    except Exception:
        spline = interpolate.interp1d(
            known_rows, known_xs, kind="linear", fill_value="extrapolate"
        )

    result = {}
    for row in range(r_min, r_max + 1):
        result[row] = float(spline(row))
    return result


def process(
    src_dir: Path,
    dst_dir: Path,
    spatial_mm: float | None,
    sweep_mm: float | None,
    sweep_interval_um: float,
    um_per_pix_spatial: float,
    smooth_sigma: float,
    make_gif: bool,
    gif_duration: int,
) -> None:
    dst_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(f for f in src_dir.iterdir() if f.suffix == ".png")
    if not files:
        print(f"PNGファイルが見つかりません: {src_dir}", file=sys.stderr)
        return

    # 画像サイズ取得
    sample = np.array(Image.open(files[0]))
    h, w = sample.shape[:2]

    # 空間方向のクロップ範囲
    if spatial_mm is not None:
        crop_px = int(spatial_mm * 1000 / um_per_pix_spatial)
        y_start = max(0, (h - crop_px) // 2)
        y_end = min(h, y_start + crop_px)
    else:
        y_start, y_end = 0, h

    spatial_size = y_end - y_start

    # 掃引方向のスライス選択
    if sweep_mm is not None:
        sweep_slices = int(sweep_mm * 1000 / sweep_interval_um)
        s_start = max(0, (len(files) - sweep_slices) // 2)
        s_end = min(len(files), s_start + sweep_slices)
        selected = files[s_start:s_end]
    else:
        selected = files

    print(f"入力: {len(files)}枚 → 選択: {len(selected)}枚")
    print(f"空間範囲: y={y_start}-{y_end} ({spatial_size}px)")
    if spatial_mm:
        print(f"空間サイズ: {spatial_mm}mm")
    if sweep_mm:
        print(f"掃引サイズ: {sweep_mm}mm ({len(selected)}スライス × {sweep_interval_um}µm)")

    # Step 1: 各スライスのプロファイル抽出 + スプライン補間
    grid = np.full((len(selected), spatial_size), np.nan)

    for si, fpath in enumerate(selected):
        img = np.array(Image.open(fpath))
        positions = extract_profile(img, y_start, y_end)
        interpolated = interpolate_profile(positions, y_start, y_end)

        for row, x in interpolated.items():
            grid[si, row - y_start] = x

    valid_before = np.count_nonzero(~np.isnan(grid))

    # Step 2: スライス間平滑化
    if smooth_sigma > 0:
        grid_smooth = grid.copy()
        for col in range(spatial_size):
            column = grid[:, col]
            valid_idx = np.where(~np.isnan(column))[0]
            if len(valid_idx) < 3:
                continue
            filled = np.interp(range(len(selected)), valid_idx, column[valid_idx])
            smoothed = ndimage.gaussian_filter1d(filled, sigma=smooth_sigma)
            min_v, max_v = valid_idx[0], valid_idx[-1]
            for si in range(min_v, max_v + 1):
                grid_smooth[si, col] = smoothed[si]
        grid = grid_smooth
        print(f"スライス間平滑化: sigma={smooth_sigma}")

    valid_after = np.count_nonzero(~np.isnan(grid))
    print(f"有効点: {valid_before} → {valid_after}")

    # Step 3: 画像に書き戻し
    for si in range(len(selected)):
        img = np.zeros((h, w), dtype=np.uint8)
        for y_off in range(spatial_size):
            x = grid[si, y_off]
            if np.isnan(x):
                continue
            px = int(round(x))
            px = max(0, min(w - 1, px))
            py = y_start + y_off
            img[py, max(0, px - 1) : min(w, px + 2)] = 255
        Image.fromarray(img).save(str(dst_dir / f"{si:04d}.png"))

    print(f"{len(selected)}枚出力 → {dst_dir}/")

    # Step 4: GIF生成
    if make_gif:
        frames = [Image.open(dst_dir / f"{i:04d}.png") for i in range(len(selected))]
        gif_path = dst_dir / "animation.gif"
        frames[0].save(
            str(gif_path),
            save_all=True,
            append_images=frames[1:],
            duration=gif_duration,
            loop=0,
        )
        print(f"GIF: {gif_path}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("input", help="マスク画像ディレクトリ")
    parser.add_argument("output", help="出力ディレクトリ")
    parser.add_argument(
        "--spatial-mm", type=float, default=None,
        help="空間方向の範囲 (mm)。中央からクロップ",
    )
    parser.add_argument(
        "--sweep-mm", type=float, default=None,
        help="掃引方向の範囲 (mm)。中央からスライス選択",
    )
    parser.add_argument(
        "--sweep-interval-um", type=float, default=100,
        help="掃引間隔 (µm, default: 100)",
    )
    parser.add_argument(
        "--um-per-pix-spatial", type=float, default=DEFAULT_UM_PER_PIX_SPATIAL,
        help=f"空間方向 µm/pix (default: {DEFAULT_UM_PER_PIX_SPATIAL})",
    )
    parser.add_argument(
        "--smooth-sigma", type=float, default=2.0,
        help="スライス間ガウシアン平滑化のsigma (default: 2, 0で無効)",
    )
    parser.add_argument(
        "--gif", action="store_true",
        help="GIFアニメーションも生成",
    )
    parser.add_argument(
        "--gif-duration", type=int, default=50,
        help="GIFのフレーム間隔 (ms, default: 50)",
    )
    args = parser.parse_args()

    process(
        src_dir=Path(args.input),
        dst_dir=Path(args.output),
        spatial_mm=args.spatial_mm,
        sweep_mm=args.sweep_mm,
        sweep_interval_um=args.sweep_interval_um,
        um_per_pix_spatial=args.um_per_pix_spatial,
        smooth_sigma=args.smooth_sigma,
        make_gif=args.gif,
        gif_duration=args.gif_duration,
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
