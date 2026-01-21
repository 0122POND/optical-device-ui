import os
import json
import numpy as np
from pathlib import Path
from PIL import Image
from scipy.ndimage import gaussian_filter
from typing import Callable, Optional, List

# --- デフォルト設定 ---
# backendディレクトリから実行されることを想定し、親ディレクトリのdataを参照
_DATA_DIR = Path(__file__).parent.parent / "data"
DEFAULT_DATA_PATH = str(_DATA_DIR / "row_data") + "/"
DEFAULT_RESULT_PATH = str(_DATA_DIR / "result") + "/"
DEFAULT_NUM_IMAGES = 170
DEFAULT_PEAK_THRESHOLD = 10


def create_gauss_window(h, w, sigma_scale=6):
    """ガウス窓を作成 (NumPy版)"""
    y = np.arange(h)
    x = np.arange(w)
    yy, xx = np.meshgrid(y, x, indexing='ij')
    cy, cx = h // 2, w // 2
    sigma_y = h / sigma_scale
    sigma_x = w / sigma_scale

    gauss = np.exp(-((xx - cx) ** 2) / (2 * sigma_x ** 2) - ((yy - cy) ** 2) / (2 * sigma_y ** 2))
    gauss = gauss / gauss.max()
    return gauss.astype(np.float32)


def run_preprocess(
    data_path: str = DEFAULT_DATA_PATH,
    result_path: str = DEFAULT_RESULT_PATH,
    num_images: int = DEFAULT_NUM_IMAGES,
    peak_threshold: int = DEFAULT_PEAK_THRESHOLD,
    progress_callback: Optional[Callable[[int, int, str], None]] = None
) -> List[str]:
    """
    画像処理を実行する

    Args:
        data_path: 入力ディレクトリ
        result_path: 出力ディレクトリ
        num_images: 処理する画像枚数
        peak_threshold: ピーク検出の閾値
        progress_callback: 進捗コールバック (current_step, total_steps, message)

    Returns:
        生成されたファイル名のリスト
    """
    total_steps = 8

    def report(step: int, message: str):
        if progress_callback:
            progress_callback(step, total_steps, message)

    os.makedirs(result_path, exist_ok=True)

    # Step 1: 画像の読み込み
    report(1, "画像を読み込み中...")
    image_files = sorted([f for f in os.listdir(data_path) if f.lower().endswith('.bmp')])[:num_images]

    if not image_files:
        raise ValueError("画像が見つかりません")

    img_list = []
    for fname in image_files:
        path = os.path.join(data_path, fname)
        img = Image.open(path).convert('L')
        img_list.append(np.array(img, dtype=np.float32))

    images = np.array(img_list)

    # Step 2: 中央値画像の計算
    report(2, "背景画像を計算中...")
    bg_image = np.median(images, axis=0)

    # Step 3: 背景差分 & クリップ
    report(3, "背景差分を計算中...")
    sub_bg = images - bg_image
    sub_bg = np.clip(sub_bg, 0, 255)

    # Step 4: 横方向差分 & 強調
    report(4, "横方向差分と強調処理中...")
    diff_x = sub_bg[:, :, 1:] - sub_bg[:, :, :-1]
    diff_x = np.abs(diff_x)

    max_val = diff_x.max()
    if max_val == 0:
        max_val = 1.0

    norm = diff_x / max_val
    enhanced = np.power(norm, 0.7) * 255

    # Step 5: ガウス窓の適用
    report(5, "ガウス窓を適用中...")
    _, h, w_diff = enhanced.shape
    gauss_window = create_gauss_window(h, w_diff, sigma_scale=6)

    gausswin = enhanced * gauss_window
    gausswin = np.clip(gausswin, 0, 255)

    # Step 6: スタックブラー
    report(6, "3次元スタックブラーを適用中...")
    blurred_stack = gaussian_filter(gausswin, sigma=(1, 7, 7))

    max_vals = np.max(blurred_stack, axis=(1, 2), keepdims=True)
    max_vals[max_vals == 0] = 1
    contrast = (blurred_stack / max_vals) * 255

    # Step 7: ピーク検出
    report(7, "ピーク検出を実行中...")
    n_img, h_img, w_img = contrast.shape
    max_indices = np.argmax(contrast, axis=2)
    max_values = np.max(contrast, axis=2)

    peak_result = np.zeros((n_img, h_img, w_img), dtype=np.uint8)
    valid_mask = max_values >= peak_threshold

    img_idx = np.arange(n_img)[:, None]
    row_idx = np.arange(h_img)[None, :]

    img_idx = np.broadcast_to(img_idx, (n_img, h_img))
    row_idx = np.broadcast_to(row_idx, (n_img, h_img))

    valid_img = img_idx[valid_mask]
    valid_row = row_idx[valid_mask]
    valid_col = max_indices[valid_mask]

    peak_result[valid_img, valid_row, valid_col] = 255
    peak_result[:, :, :-1] = peak_result[:, :, :-1] | peak_result[:, :, 1:]

    # Step 8: 保存
    report(8, "結果を保存中...")
    output_files = []

    for i, fname in enumerate(image_files):
        base_name = os.path.splitext(fname)[0]
        save_name = f"{base_name}_gausswin_stackblur_contrast_peak.bmp"
        save_path = os.path.join(result_path, save_name)

        Image.fromarray(peak_result[i]).save(save_path)
        output_files.append(save_name)

    # manifest.json を生成
    manifest_path = os.path.join(result_path, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump({"files": output_files}, f, indent=2)

    return output_files


# CLI実行用
if __name__ == "__main__":
    def print_progress(step: int, total: int, message: str):
        print(f"[{step}/{total}] {message}")

    run_preprocess(progress_callback=print_progress)
    print("完了しました")
