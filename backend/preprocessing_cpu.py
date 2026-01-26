import os
import json
import numpy as np
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional, List

import cv2
from scipy.ndimage import gaussian_filter

# --- デフォルト設定 ---
_DATA_DIR = Path(__file__).parent.parent / "data"
DEFAULT_DATA_PATH = str(_DATA_DIR / "row_data") + "/"
DEFAULT_RESULT_PATH = str(_DATA_DIR / "result") + "/"
DEFAULT_PEAK_THRESHOLD = 10


def create_gauss_window(h, w, sigma_scale=6):
    """ガウス窓を作成"""
    cy, cx = h // 2, w // 2
    sigma_y = h / sigma_scale
    sigma_x = w / sigma_scale

    y = np.arange(h, dtype=np.float32) - cy
    x = np.arange(w, dtype=np.float32) - cx

    gy = np.exp(-y**2 / (2 * sigma_y**2))
    gx = np.exp(-x**2 / (2 * sigma_x**2))

    gauss = np.outer(gy, gx)
    gauss /= gauss.max()
    return gauss


def _load_image(path: str) -> np.ndarray:
    """OpenCVで画像を読み込み（並列処理用）"""
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError(f"画像を読み込めません: {path}")
    return img.astype(np.float32)


def _save_image(args: tuple) -> str:
    """画像を保存（並列処理用）"""
    save_path, data = args
    cv2.imwrite(save_path, data)
    return os.path.basename(save_path)


def run_preprocess(
    data_path: str = DEFAULT_DATA_PATH,
    result_path: str = DEFAULT_RESULT_PATH,
    peak_threshold: int = DEFAULT_PEAK_THRESHOLD,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
) -> List[str]:
    """
    画像処理を実行する（CPU版）

    Args:
        data_path: 入力ディレクトリ
        result_path: 出力ディレクトリ
        peak_threshold: ピーク検出の閾値
        progress_callback: 進捗コールバック (current_step, total_steps, message)

    Returns:
        生成されたファイル名のリスト
    """
    total_steps = 8

    def report(step: int, message: str):
        if progress_callback:
            progress_callback(step, total_steps, f"[CPU] {message}")

    os.makedirs(result_path, exist_ok=True)

    # Step 1: 画像の並列読み込み
    report(1, "画像を読み込み中...")
    image_files = sorted([f for f in os.listdir(data_path) if f.lower().endswith('.bmp')])

    if not image_files:
        raise ValueError("画像が見つかりません")

    paths = [os.path.join(data_path, f) for f in image_files]
    with ThreadPoolExecutor() as executor:
        img_list = list(executor.map(_load_image, paths))

    images = np.stack(img_list)

    # Step 2: 中央値画像の計算
    report(2, "背景画像を計算中...")
    bg_image = np.median(images, axis=0)

    # Step 3: 背景差分 & クリップ
    report(3, "背景差分を計算中...")
    sub_bg = np.maximum(images - bg_image, 0)

    # Step 4: 横方向差分 & 強調
    report(4, "横方向差分と強調処理中...")
    diff_x = np.abs(sub_bg[:, :, 1:] - sub_bg[:, :, :-1])

    max_val = float(diff_x.max())
    if max_val == 0:
        max_val = 1.0

    inv_max = 1.0 / max_val
    enhanced = np.power(diff_x * inv_max, 0.7) * 255

    # Step 5: ガウス窓の適用
    report(5, "ガウス窓を適用中...")
    _, h, w_diff = enhanced.shape
    gauss_window = create_gauss_window(h, w_diff, sigma_scale=6)

    gausswin = np.minimum(enhanced * gauss_window, 255)

    # Step 6: スタックブラー（3次元ガウスフィルタ）
    report(6, "3次元スタックブラーを適用中...")
    blurred_stack = gaussian_filter(gausswin, sigma=(1, 7, 7))

    # コントラスト正規化
    max_vals = np.max(blurred_stack, axis=(1, 2), keepdims=True)
    max_vals = np.where(max_vals == 0, 1, max_vals)
    contrast = blurred_stack / max_vals * 255

    # Step 7: ピーク検出
    report(7, "ピーク検出を実行中...")
    n_img, h_img, w_img = contrast.shape

    # argmaxとmaxを効率的に計算
    max_indices = np.argmax(contrast, axis=2)
    max_values = np.take_along_axis(contrast, max_indices[:, :, np.newaxis], axis=2).squeeze(axis=2)

    peak_result = np.zeros((n_img, h_img, w_img), dtype=np.uint8)
    valid_mask = max_values >= peak_threshold

    # インデックス配列を効率的に生成
    img_idx, row_idx = np.mgrid[:n_img, :h_img]

    valid_img = img_idx[valid_mask]
    valid_row = row_idx[valid_mask]
    valid_col = max_indices[valid_mask]

    peak_result[valid_img, valid_row, valid_col] = 255
    peak_result[:, :, :-1] |= peak_result[:, :, 1:]

    # Step 8: 並列保存
    report(8, "結果を保存中...")
    save_args = []
    output_files = []

    for i, fname in enumerate(image_files):
        base_name = os.path.splitext(fname)[0]
        save_name = f"{base_name}_gausswin_stackblur_contrast_peak.bmp"
        save_path = os.path.join(result_path, save_name)
        save_args.append((save_path, peak_result[i]))
        output_files.append(save_name)

    with ThreadPoolExecutor() as executor:
        list(executor.map(_save_image, save_args))

    # manifest.json を生成
    manifest_path = os.path.join(result_path, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump({"files": output_files}, f, indent=2)

    return output_files


# CLI実行用
if __name__ == "__main__":
    def print_progress(step: int, total: int, message: str):
        print(f"[{step}/{total}] {message}")

    print("CPU mode")
    run_preprocess(progress_callback=print_progress)
    print("完了しました")
