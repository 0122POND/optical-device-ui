"""
キーエンスの3D高さマップCSVから、縦方向（掃引方向）に等間隔でスライスし、
干渉縞の断層画像風の白黒マスク画像を生成する。

各スライスは特定のY位置での断面プロファイルを描画。
横軸=空間位置(X)、縦軸=高さ(深さ方向)で、表面の断面形状が白い線として描画される。
line-finder-ai の教師データ（正解マスク）として利用可能。

Usage:
    python keyence_to_slices.py input.csv output_dir/
    python keyence_to_slices.py input.csv output_dir/ --sweep-interval 5 --line-width 3
    python keyence_to_slices.py data/surface_keyence/ output_dir/ --batch
"""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def load_keyence_csv(path: str) -> np.ndarray:
    """キーエンスCSVを読み込み、-9999.9を NaN に変換"""
    data = np.loadtxt(path, delimiter=",")
    data[data <= -9999.0] = np.nan
    return data


def generate_slices(
    height_map: np.ndarray,
    sweep_interval_rows: int = 1,
    line_width: int = 2,
    um_per_pix_depth: float = 1.8,
    um_per_pix_spatial: float = 20.0,
    keyence_fov_um: float = 10000.0,
) -> list[tuple[int, np.ndarray]]:
    """
    高さマップを縦方向（Y方向）に等間隔でスライスし、
    各スライスの断面プロファイルを白黒画像として生成する。
    画像スケールはInfinicamのµm/pixに合わせる。

    Args:
        height_map: 2D高さマップ (NaN=欠損), shape=(rows, cols)
        sweep_interval_rows: 何行おきにスライスするか
        line_width: 描画する線の太さ (px)
        um_per_pix_depth: 深さ方向の換算係数 (µm/pix, default: 1.8)
        um_per_pix_spatial: 空間方向の換算係数 (µm/pix, default: 20)
        keyence_fov_um: キーエンスの測定範囲の1辺 (µm, default: 10000)

    Returns:
        list of (row_index, mask_image_uint8)
    """
    rows, cols = height_map.shape

    # キーエンスの1列あたりの空間分解能
    keyence_um_per_col = keyence_fov_um / cols

    # 全体の高さ範囲を取得
    valid = height_map[~np.isnan(height_map)]
    if len(valid) == 0:
        return []
    z_min = float(valid.min())
    z_max = float(valid.max())
    z_span = z_max - z_min
    if z_span < 1e-9:
        return []

    # 回転後にマスク画像と同じ1246×1008(横長)になるよう設定
    # 回転前: (1246, 1008) → 90°CW回転後: (1008, 1246) = height=1008, width=1246
    img_h = 1246
    img_w = 1008

    # Infinicamスケールでの描画サイズ（この範囲内に線を描く）
    content_h = max(1, int(z_span / um_per_pix_depth))
    content_w = max(1, int(cols * keyence_um_per_col / um_per_pix_spatial))

    # 中央に配置するためのオフセット
    offset_y = (img_h - content_h) // 2
    offset_x = (img_w - content_w) // 2

    slices = []
    for row_idx in range(0, rows, sweep_interval_rows):
        profile = height_map[row_idx, :]

        img = np.zeros((img_h, img_w), dtype=np.uint8)

        for col in range(cols):
            z_val = profile[col]
            if np.isnan(z_val):
                continue

            # 高さをピクセルY座標に変換（上が高い）、中央配置
            norm = (z_val - z_min) / z_span
            py = offset_y + int((1.0 - norm) * (content_h - 1))
            py = max(0, min(img_h - 1, py))

            # X座標（物理スケールに基づく）、中央配置
            px = offset_x + int(col * keyence_um_per_col / um_per_pix_spatial)
            px = max(0, min(img_w - 1, px))

            # 線幅分だけ描画
            half = line_width // 2
            y1 = max(0, py - half)
            y2 = min(img_h, py + half + 1)
            img[y1:y2, px] = 255

        # 時計回りに90度回転（実際の干渉縞表示に合わせる）
        img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        slices.append((row_idx, img))

    return slices


def save_gif(coin_dir: Path, gif_path: Path, duration_ms: int = 50) -> None:
    """coin_dir 内の連番 PNG をまとめて GIF 化。"""
    png_files = sorted(coin_dir.glob("*.png"))
    if not png_files:
        print(f"  GIF スキップ（PNG なし）: {coin_dir}")
        return
    frames = [Image.open(p) for p in png_files]
    frames[0].save(
        str(gif_path),
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=0,
        optimize=True,
    )
    size_kb = gif_path.stat().st_size / 1024
    print(f"  GIF: {gif_path.name} ({len(frames)}枚, {size_kb:.0f}KB)")


def process_single(
    csv_path: Path,
    output_dir: Path,
    sweep_interval_rows: int,
    line_width: int,
    um_per_pix_depth: float,
    um_per_pix_spatial: float,
    keyence_fov_um: float,
    make_gif: bool = False,
    gif_duration: int = 50,
) -> int:
    """1ファイルを処理。生成枚数を返す。"""
    height_map = load_keyence_csv(str(csv_path))
    valid = height_map[~np.isnan(height_map)]
    if len(valid) == 0:
        print(f"  スキップ（有効データなし）: {csv_path.name}")
        return 0

    rows, cols = height_map.shape
    z_min, z_max = float(valid.min()), float(valid.max())
    z_span = z_max - z_min
    expected = (rows + sweep_interval_rows - 1) // sweep_interval_rows

    keyence_um_per_col = keyence_fov_um / cols
    content_depth_px = max(1, int(z_span / um_per_pix_depth))
    content_spatial_px = max(1, int(cols * keyence_um_per_col / um_per_pix_spatial))
    print(
        f"  {csv_path.name}: shape={height_map.shape} "
        f"range=[{z_min:.1f}, {z_max:.1f}]µm span={z_span:.1f}µm → {expected}枚 "
        f"(画像: 1246×1008, 描画領域: {content_spatial_px}×{content_depth_px} px)"
    )

    slices = generate_slices(
        height_map, sweep_interval_rows, line_width,
        um_per_pix_depth, um_per_pix_spatial, keyence_fov_um,
    )

    coin_dir = output_dir / csv_path.stem
    coin_dir.mkdir(parents=True, exist_ok=True)

    for idx, (row_idx, mask) in enumerate(slices):
        out_path = coin_dir / f"{idx:04d}.png"
        cv2.imwrite(str(out_path), mask)

    if make_gif and slices:
        gif_path = output_dir / f"{csv_path.stem}.gif"
        save_gif(coin_dir, gif_path, duration_ms=gif_duration)

    return len(slices)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("input", help="キーエンスCSVファイル or ディレクトリ")
    parser.add_argument("output", help="出力ディレクトリ")
    parser.add_argument(
        "--sweep-interval",
        type=int,
        default=1,
        help="何行おきにスライスするか (default: 1 = 全行)",
    )
    parser.add_argument(
        "--line-width",
        type=int,
        default=2,
        help="断面線の太さ (px, default: 2)",
    )
    parser.add_argument(
        "--um-per-pix-depth",
        type=float,
        default=1.8,
        help="深さ方向の換算係数 (µm/pix, default: 1.8, Infinicam X軸)",
    )
    parser.add_argument(
        "--um-per-pix-spatial",
        type=float,
        default=20.0,
        help="空間方向の換算係数 (µm/pix, default: 20, Infinicam Y軸)",
    )
    parser.add_argument(
        "--keyence-fov",
        type=float,
        default=10000.0,
        help="キーエンス測定範囲の1辺 (µm, default: 10000 = 10mm)",
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        help="inputがディレクトリの場合、中の全CSVを処理",
    )
    parser.add_argument(
        "--gif",
        action="store_true",
        help="各コイン分のアニメーション GIF を output 直下に生成",
    )
    parser.add_argument(
        "--gif-duration",
        type=int,
        default=50,
        help="GIF 1 フレームの表示時間 (ms, default: 50)",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output)

    if args.batch or input_path.is_dir():
        csv_files = sorted(input_path.glob("*.csv"))
        if not csv_files:
            print(f"CSVファイルが見つかりません: {input_path}", file=sys.stderr)
            return 1
        print(f"バッチ処理: {len(csv_files)}ファイル")
        print(f"掃引間隔: {args.sweep_interval}行, 線幅: {args.line_width}px")
        print(f"スケール: 深さ={args.um_per_pix_depth}µm/pix, 空間={args.um_per_pix_spatial}µm/pix, FOV={args.keyence_fov}µm")
        print()
        total = 0
        for csv_file in csv_files:
            n = process_single(
                csv_file, output_dir, args.sweep_interval, args.line_width,
                args.um_per_pix_depth, args.um_per_pix_spatial, args.keyence_fov,
                make_gif=args.gif, gif_duration=args.gif_duration,
            )
            total += n
        print(f"\n合計: {total}枚生成 → {output_dir}")
    else:
        if not input_path.exists():
            print(f"ファイルが見つかりません: {input_path}", file=sys.stderr)
            return 1
        print(f"掃引間隔: {args.sweep_interval}行, 線幅: {args.line_width}px")
        print(f"スケール: 深さ={args.um_per_pix_depth}µm/pix, 空間={args.um_per_pix_spatial}µm/pix, FOV={args.keyence_fov}µm")
        n = process_single(
            input_path, output_dir, args.sweep_interval, args.line_width,
            args.um_per_pix_depth, args.um_per_pix_spatial, args.keyence_fov,
            make_gif=args.gif, gif_duration=args.gif_duration,
        )
        print(f"\n{n}枚生成 → {output_dir}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
