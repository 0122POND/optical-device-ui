"""
単一カメラ画像から Depth Anything V2 で疑似3D点群を推定し、
Keyence互換の高さマップCSV（-9999.9欠損、µm単位）を出力する。

Usage:
    python image_to_depth_csv.py input.jpg output.csv
    python image_to_depth_csv.py input.jpg output.csv \\
        --model depth-anything/Depth-Anything-V2-Base-hf \\
        --height-range 2000 --invert --max-size 1024
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", help="入力画像パス (jpg/png/bmp等)")
    parser.add_argument("output", help="出力CSVパス")
    parser.add_argument(
        "--model",
        default="depth-anything/Depth-Anything-V2-Small-hf",
        help="HuggingFaceモデルID (Small/Base/Large)",
    )
    parser.add_argument(
        "--height-range",
        type=float,
        default=1000.0,
        help="高さレンジ(µm)。正規化深度に乗算 (default: 1000)",
    )
    parser.add_argument(
        "--height-min",
        type=float,
        default=0.0,
        help="最小高さ(µm) (default: 0)",
    )
    parser.add_argument(
        "--invert",
        action="store_true",
        help="深度→高さ反転（手前が高くなる）",
    )
    parser.add_argument(
        "--max-size",
        type=int,
        default=None,
        help="最大辺のリサイズ上限。未指定なら原寸（モデル側で自動リサイズ）",
    )
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cpu", "cuda", "mps"],
        help="推論デバイス",
    )
    args = parser.parse_args()

    import torch
    from transformers import pipeline

    if args.device == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
    else:
        device = args.device

    in_path = Path(args.input)
    out_path = Path(args.output)
    if not in_path.exists():
        print(f"入力画像が見つかりません: {in_path}", file=sys.stderr)
        return 1

    image = Image.open(in_path).convert("RGB")
    print(f"入力: {in_path}  size={image.size}")

    if args.max_size is not None:
        image.thumbnail((args.max_size, args.max_size))
        print(f"リサイズ後: {image.size}")

    print(f"モデルロード中: {args.model} (device={device})")
    pipe = pipeline("depth-estimation", model=args.model, device=device)

    print("推論中...")
    result = pipe(image)
    depth = result["predicted_depth"]
    if hasattr(depth, "detach"):
        depth = depth.detach().cpu().numpy()
    else:
        depth = np.asarray(depth)
    depth = np.squeeze(depth)

    dmin, dmax = float(depth.min()), float(depth.max())
    if dmax > dmin:
        norm = (depth - dmin) / (dmax - dmin)
    else:
        norm = np.zeros_like(depth, dtype=np.float32)

    if args.invert:
        norm = 1.0 - norm

    height_um = norm * args.height_range + args.height_min

    # Keyence互換CSV: ヘッダーなし、-9999.9=欠損、各行カンマ区切り
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for row in height_um:
            f.write(",".join(f"{v:.1f}" for v in row) + "\n")

    print(
        f"保存: {out_path}  shape={height_um.shape}  "
        f"range=[{height_um.min():.1f}, {height_um.max():.1f}] µm"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
