"""BMP/PNG画像をHDF5に変換（I/O高速化用）

170個の画像ファイルを個別に開くのではなく、1つのHDF5ファイルとして
一括読み込みすることでファイルオープンのオーバーヘッドを削減する。

Usage:
    python convert_to_hdf5.py
    python convert_to_hdf5.py --input ../data/row_data/ --output ../data/row_data.h5
    python convert_to_hdf5.py --compression lzf   # 高速・低圧縮率
"""
import os
import re
import argparse
import numpy as np
import cv2
import h5py
from pathlib import Path
from typing import Optional, Callable

_DATA_DIR = Path(__file__).parent.parent / "data"


def convert_to_hdf5(
    input_dir: str = None,
    output_path: str = None,
    compression: str = "gzip",
    progress_callback: Optional[Callable[[str], None]] = None,
) -> str:
    """画像ファイル群を単一のHDF5ファイルに変換する

    Args:
        input_dir: 入力画像ディレクトリ
        output_path: 出力HDF5ファイルパス
        compression: 圧縮方式 ("gzip", "lzf", None)
        progress_callback: 進捗コールバック (message)

    Returns:
        出力ファイルパス
    """
    if input_dir is None:
        input_dir = str(_DATA_DIR / "row_data")
    if output_path is None:
        output_path = str(_DATA_DIR / "row_data.h5")

    def log(msg: str):
        if progress_callback:
            progress_callback(msg)
        else:
            print(msg)

    # 画像ファイルの検索とソート
    image_files = sorted(
        [f for f in os.listdir(input_dir) if f.lower().endswith((".bmp", ".png"))],
        key=lambda f: int((re.search(r"img_(\d+)", f) or re.search(r"(\d+)", f)).group(1)),
    )

    if not image_files:
        raise ValueError(f"画像が見つかりません: {input_dir}")

    # 最初の画像からサイズを取得
    first = cv2.imread(
        os.path.join(input_dir, image_files[0]), cv2.IMREAD_GRAYSCALE
    )
    if first is None:
        raise ValueError(f"画像を読み込めません: {image_files[0]}")
    h, w = first.shape
    n = len(image_files)

    log(f"{n}枚の画像 ({h}x{w}) をHDF5に変換中...")

    # 圧縮設定
    comp_kwargs = {}
    if compression:
        comp_kwargs["compression"] = compression
        if compression == "gzip":
            comp_kwargs["compression_opts"] = 1  # 最速レベル

    with h5py.File(output_path, "w") as f:
        # 画像データセット（1画像=1チャンク、シーケンシャルアクセスに最適）
        dset = f.create_dataset(
            "images",
            shape=(n, h, w),
            dtype=np.float32,
            chunks=(1, h, w),
            **comp_kwargs,
        )

        # 元のファイル名を保存（前処理結果のファイル名生成に必要）
        dt = h5py.string_dtype()
        f.create_dataset("filenames", data=image_files, dtype=dt)

        # 画像を1枚ずつ書き込み
        for i, fname in enumerate(image_files):
            path = os.path.join(input_dir, fname)
            img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
            if img is None:
                raise ValueError(f"画像を読み込めません: {path}")
            dset[i] = img.astype(np.float32)

            if (i + 1) % 50 == 0 or i == n - 1:
                log(f"  変換中: {i + 1}/{n}")

    file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
    log(f"完了: {output_path} ({file_size_mb:.1f} MB)")
    return output_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="画像をHDF5に変換")
    parser.add_argument("--input", default=None, help="入力ディレクトリ")
    parser.add_argument("--output", default=None, help="出力HDF5ファイルパス")
    parser.add_argument(
        "--compression",
        default="gzip",
        choices=["gzip", "lzf", "none"],
        help="圧縮方式 (default: gzip)",
    )
    args = parser.parse_args()

    comp = None if args.compression == "none" else args.compression
    convert_to_hdf5(args.input, args.output, comp)
