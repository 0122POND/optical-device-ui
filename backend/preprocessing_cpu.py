import os
import re
import json
import numpy as np
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional, List

import cv2
from scipy.ndimage import gaussian_filter1d


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


def _apply_peak_mask(peak_data: np.ndarray, keep_px: int = 45) -> np.ndarray:
    """ピーク検出結果にマスクを適用（基準列の左右keep_px以外をゼロに）"""
    n_images, h, w = peak_data.shape

    # 各画像の列ごとの白画素数 (n_images, w)
    col_counts = np.count_nonzero(peak_data > 128, axis=1)

    # 各画像の基準列（白画素が最も多い列） (n_images,)
    x0 = np.argmax(col_counts, axis=1)

    # マスク: 基準列の左右keep_px内のみ保持 (n_images, 1, w)
    col_idx = np.arange(w)[np.newaxis, :]
    x0_col = x0[:, np.newaxis]
    keep_mask = (col_idx >= x0_col - keep_px) & (col_idx <= x0_col + keep_px)

    return np.where(keep_mask[:, np.newaxis, :], peak_data, 0)


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
) -> dict:
    """
    画像処理を実行する（CPU版）

    Args:
        data_path: 入力ディレクトリ
        result_path: 出力ディレクトリ（save_peak_results用、この関数では未使用）
        peak_threshold: ピーク検出の閾値
        progress_callback: 進捗コールバック (current_step, total_steps, message)

    Returns:
        {"peak_data": np.ndarray, "image_files": list, "output_files": list}
    """
    total_steps = 8

    def report(step: int, message: str):
        if progress_callback:
            progress_callback(step, total_steps, f"[CPU] {message}")

    # Step 1: 画像の読み込み
    report(1, "画像を読み込み中...")

    image_files = sorted(
        [f for f in os.listdir(data_path) if f.lower().endswith(('.bmp', '.png'))],
        key=lambda f: int((re.search(r'img_(\d+)', f) or re.search(r'(\d+)', f)).group(1))
    )

    if not image_files:
        raise ValueError("画像が見つかりません")

    paths = [os.path.join(data_path, f) for f in image_files]
    with ThreadPoolExecutor() as executor:
        img_list = list(executor.map(_load_image, paths))

    images = np.stack(img_list)
    del img_list

    # Step 2: 中央値画像の計算
    report(2, "背景画像を計算中...")
    bg_image = np.median(images, axis=0).astype(np.float32)

    # Step 3: 背景差分 & クリップ
    report(3, "背景差分を計算中...")
    sub_bg = np.maximum(images - bg_image, 0)
    del images, bg_image

    # Step 4: 横方向差分 & 強調
    report(4, "横方向差分と強調処理中...")
    diff_x = np.abs(sub_bg[:, :, 1:] - sub_bg[:, :, :-1])
    del sub_bg

    max_val = float(diff_x.max())
    if max_val == 0:
        max_val = 1.0

    inv_max = np.float32(1.0 / max_val)
    enhanced = np.power(diff_x * inv_max, np.float32(0.7)) * 255
    del diff_x

    # Step 5: ガウス窓の適用
    report(5, "ガウス窓を適用中...")
    _, h, w_diff = enhanced.shape
    gauss_window = create_gauss_window(h, w_diff, sigma_scale=6)

    gausswin = np.minimum(enhanced * gauss_window, 255)
    del enhanced

    # Step 6: スタックブラー（3次元ガウスフィルタ）
    # OpenCV + scipy.ndimage.gaussian_filter1d で高速化
    report(6, "3次元スタックブラーを適用中...")

    # axis=0 (画像間方向) のガウスフィルタ
    # 【検証中】掃引間隔10µm/枚なのでσ=10（デフォルト100µm/枚×σ1と同じ物理±400µmスケール）
    temp = gaussian_filter1d(gausswin, sigma=10, axis=0)
    del gausswin

    # axis=1,2 (2D画像) に sigma=7 のガウスフィルタ（OpenCVで高速化）
    def blur_2d(img):
        return cv2.GaussianBlur(img.astype(np.float32), (0, 0), sigmaX=7, sigmaY=7)

    with ThreadPoolExecutor() as executor:
        blurred_list = list(executor.map(blur_2d, temp))
    del temp
    blurred_stack = np.stack(blurred_list)
    del blurred_list

    # コントラスト正規化
    max_vals = np.max(blurred_stack, axis=(1, 2), keepdims=True)
    max_vals = np.where(max_vals == 0, 1, max_vals)
    contrast = blurred_stack / max_vals * 255
    del blurred_stack

    # Step 7: ピーク検出 (argmax)
    report(7, "ピーク検出 (argmax)...")
    n_img, h_img, w_img = contrast.shape

    max_indices = np.argmax(contrast, axis=2)
    max_values = np.take_along_axis(contrast, max_indices[:, :, np.newaxis], axis=2).squeeze(axis=2)

    peak_result = np.zeros((n_img, h_img, w_img), dtype=np.uint8)
    valid_mask = max_values >= peak_threshold

    img_idx, row_idx = np.mgrid[:n_img, :h_img]

    valid_img = img_idx[valid_mask]
    valid_row = row_idx[valid_mask]
    valid_col = max_indices[valid_mask]

    peak_result[valid_img, valid_row, valid_col] = 255

    # 線の視認性のため 1px 右膨張（従来挙動を維持）
    peak_result[:, :, :-1] |= peak_result[:, :, 1:]

    # Step 8: ピークマスク適用
    report(8, "ピークマスクを適用中...")
    peak_result = _apply_peak_mask(peak_result)

    # 出力ファイル名リストを生成（保存は呼び出し側で行う）
    output_files = []
    for fname in image_files:
        base_name = os.path.splitext(fname)[0]
        save_name = f"{base_name}_gausswin_stackblur_contrast_peak.png"
        output_files.append(save_name)

    return {
        "peak_data": peak_result,
        "image_files": image_files,
        "output_files": output_files,
    }


def save_peak_results(
    peak_data: np.ndarray,
    image_files: List[str],
    result_path: str = DEFAULT_RESULT_PATH,
) -> List[str]:
    """ピーク検出結果をディスクに保存する"""
    os.makedirs(result_path, exist_ok=True)

    # 既存の結果ファイルをクリア
    for old_file in os.listdir(result_path):
        old_path = os.path.join(result_path, old_file)
        if os.path.isfile(old_path):
            os.remove(old_path)

    save_args = []
    output_files = []
    for i, fname in enumerate(image_files):
        base_name = os.path.splitext(fname)[0]
        save_name = f"{base_name}_gausswin_stackblur_contrast_peak.png"
        save_path = os.path.join(result_path, save_name)
        save_args.append((save_path, peak_data[i]))
        output_files.append(save_name)

    max_workers = min(32, len(save_args))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        list(executor.map(_save_image, save_args))

    manifest_path = os.path.join(result_path, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump({"files": output_files}, f, indent=2)

    return output_files


# CLI実行用
if __name__ == "__main__":
    def print_progress(step: int, total: int, message: str):
        print(f"[{step}/{total}] {message}")

    print("CPU mode")
    result = run_preprocess(progress_callback=print_progress)
    save_peak_results(result["peak_data"], result["image_files"])
    print("完了しました")
