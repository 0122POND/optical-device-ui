import os
import re
import json
import numpy as np
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional, List

import cv2

try:
    import h5py
    HDF5_AVAILABLE = True
except ImportError:
    HDF5_AVAILABLE = False

# --- GPU対応: CuPyが使用可能か判定 ---
try:
    import cupy as cp
    from cupyx.scipy.ndimage import gaussian_filter, gaussian_filter1d
    GPU_AVAILABLE = True
except ImportError:
    cp = None
    from scipy.ndimage import gaussian_filter, gaussian_filter1d
    GPU_AVAILABLE = False

# --- デフォルト設定 ---
# backendディレクトリから実行されることを想定し、親ディレクトリのdataを参照
_DATA_DIR = Path(__file__).parent.parent / "data"
DEFAULT_DATA_PATH = str(_DATA_DIR / "row_data") + "/"
DEFAULT_RESULT_PATH = str(_DATA_DIR / "result") + "/"
DEFAULT_PEAK_THRESHOLD = 10


def get_array_module(use_gpu: bool = True):
    """使用する配列モジュールを取得（GPU/CPU自動切り替え）"""
    if use_gpu and GPU_AVAILABLE:
        return cp
    return np


def to_gpu(arr, xp):
    """配列をGPUに転送（GPUが使用可能な場合）"""
    if xp is cp:
        return cp.asarray(arr)
    return arr


def to_cpu(arr):
    """配列をCPUに転送（CuPy配列の場合のみ）"""
    if GPU_AVAILABLE and isinstance(arr, cp.ndarray):
        return cp.asnumpy(arr)
    return arr


def create_gauss_window(h, w, sigma_scale=6, xp=np):
    """ガウス窓を作成（GPU/CPU対応）"""
    cy, cx = h // 2, w // 2
    sigma_y = h / sigma_scale
    sigma_x = w / sigma_scale

    y = xp.arange(h, dtype=xp.float32) - cy
    x = xp.arange(w, dtype=xp.float32) - cx

    gy = xp.exp(-y**2 / (2 * sigma_y**2))
    gx = xp.exp(-x**2 / (2 * sigma_x**2))

    gauss = xp.outer(gy, gx)
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
    use_gpu: bool = True
) -> dict:
    """
    画像処理を実行する（GPU/CPU自動切り替え版）

    Args:
        data_path: 入力ディレクトリ
        result_path: 出力ディレクトリ（save_peak_results用、この関数では未使用）
        peak_threshold: ピーク検出の閾値
        progress_callback: 進捗コールバック (current_step, total_steps, message)
        use_gpu: GPUを使用するかどうか（Trueでも利用不可なら自動でCPUにフォールバック）

    Returns:
        {"peak_data": np.ndarray, "image_files": list, "output_files": list}
    """
    total_steps = 8

    # 使用する配列モジュールを決定
    xp = get_array_module(use_gpu)
    using_gpu = xp is cp

    def report(step: int, message: str):
        if progress_callback:
            device = "GPU" if using_gpu else "CPU"
            progress_callback(step, total_steps, f"[{device}] {message}")

    # Step 1: 画像の読み込み（HDF5優先、なければ個別ファイル）
    report(1, "画像を読み込み中...")

    data_dir = Path(data_path).resolve()
    hdf5_path = data_dir.parent / f"{data_dir.name}.h5"

    if HDF5_AVAILABLE and hdf5_path.exists():
        # HDF5: 1ファイルからの一括読み込み（高速）
        with h5py.File(str(hdf5_path), "r") as f:
            images_np = f["images"][:]
            image_files = list(f["filenames"][:])
            if image_files and isinstance(image_files[0], bytes):
                image_files = [n.decode() for n in image_files]
        images = to_gpu(images_np, xp)
        del images_np
    else:
        # フォールバック: 個別ファイルの並列読み込み
        image_files = sorted(
            [f for f in os.listdir(data_path) if f.lower().endswith(('.bmp', '.png'))],
            key=lambda f: int((re.search(r'img_(\d+)', f) or re.search(r'(\d+)', f)).group(1))
        )

        if not image_files:
            raise ValueError("画像が見つかりません")

        paths = [os.path.join(data_path, f) for f in image_files]
        with ThreadPoolExecutor() as executor:
            img_list = list(executor.map(_load_image, paths))

        images = xp.stack([to_gpu(img, xp) for img in img_list])
        del img_list

    # Step 2: 中央値画像の計算
    report(2, "背景画像を計算中...")
    bg_image = xp.median(images, axis=0)

    # Step 3: 背景差分 & クリップ
    report(3, "背景差分を計算中...")
    sub_bg = xp.maximum(images - bg_image, 0)

    # Step 4: 横方向差分 & 強調
    report(4, "横方向差分と強調処理中...")
    diff_x = xp.abs(sub_bg[:, :, 1:] - sub_bg[:, :, :-1])

    max_val = float(diff_x.max())
    if max_val == 0:
        max_val = 1.0

    inv_max = 1.0 / max_val
    enhanced = xp.power(diff_x * inv_max, 0.7) * 255

    # Step 5: ガウス窓の適用
    report(5, "ガウス窓を適用中...")
    _, h, w_diff = enhanced.shape
    gauss_window = create_gauss_window(h, w_diff, sigma_scale=6, xp=xp)

    gausswin = xp.minimum(enhanced * gauss_window, 255)

    # Step 6: スタックブラー（3次元ガウスフィルタ）
    report(6, "3次元スタックブラーを適用中...")

    # GPU: CuPyのgaussian_filter、CPU: SciPyのgaussian_filter
    blurred_stack = gaussian_filter(gausswin, sigma=(1, 7, 7))

    # コントラスト正規化
    max_vals = xp.max(blurred_stack, axis=(1, 2), keepdims=True)
    max_vals = xp.where(max_vals == 0, 1, max_vals)
    contrast = blurred_stack / max_vals * 255

    # Step 7: ピーク検出
    report(7, "ピーク検出を実行中...")
    n_img, h_img, w_img = contrast.shape

    # argmaxとmaxを効率的に計算
    max_indices = xp.argmax(contrast, axis=2)
    max_values = xp.take_along_axis(contrast, max_indices[:, :, xp.newaxis], axis=2).squeeze(axis=2)

    peak_result = xp.zeros((n_img, h_img, w_img), dtype=xp.uint8)
    valid_mask = max_values >= peak_threshold

    # インデックス配列を効率的に生成
    img_idx, row_idx = xp.mgrid[:n_img, :h_img]

    valid_img = img_idx[valid_mask]
    valid_row = row_idx[valid_mask]
    valid_col = max_indices[valid_mask]

    peak_result[valid_img, valid_row, valid_col] = 255
    peak_result[:, :, :-1] |= peak_result[:, :, 1:]

    # GPUからCPUに転送
    peak_result_cpu = to_cpu(peak_result)

    # Step 8: ピークマスク適用
    report(8, "ピークマスクを適用中...")
    peak_result_cpu = _apply_peak_mask(peak_result_cpu)

    # 出力ファイル名リストを生成（保存は呼び出し側で行う）
    output_files = []
    for fname in image_files:
        base_name = os.path.splitext(fname)[0]
        save_name = f"{base_name}_gausswin_stackblur_contrast_peak.png"
        output_files.append(save_name)

    return {
        "peak_data": peak_result_cpu,
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


def is_gpu_available() -> bool:
    """GPUが使用可能かどうかを返す"""
    return GPU_AVAILABLE


def get_gpu_info() -> dict:
    """GPU情報を取得"""
    if not GPU_AVAILABLE:
        return {"available": False, "message": "CuPy is not installed or CUDA is not available"}

    try:
        device = cp.cuda.Device()
        props = cp.cuda.runtime.getDeviceProperties(device.id)
        return {
            "available": True,
            "device_id": device.id,
            "name": props["name"].decode() if isinstance(props["name"], bytes) else props["name"],
            "total_memory_gb": props["totalGlobalMem"] / (1024**3),
        }
    except Exception as e:
        return {"available": False, "message": str(e)}


# CLI実行用
if __name__ == "__main__":
    def print_progress(step: int, total: int, message: str):
        print(f"[{step}/{total}] {message}")

    # GPU情報を表示
    gpu_info = get_gpu_info()
    if gpu_info["available"]:
        print(f"GPU検出: {gpu_info['name']} ({gpu_info['total_memory_gb']:.1f} GB)")
    else:
        print(f"GPU未検出: {gpu_info.get('message', 'CPU mode')}")

    result = run_preprocess(progress_callback=print_progress)
    save_peak_results(result["peak_data"], result["image_files"])
    print("完了しました")
