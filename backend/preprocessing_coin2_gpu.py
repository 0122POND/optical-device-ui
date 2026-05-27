import os
import re
import json
import numpy as np
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional, List

import cv2
import cupy as cp
from cupyx.scipy.ndimage import gaussian_filter


# --- デフォルト設定 ---
_DATA_DIR = Path(__file__).parent.parent / "data"
DEFAULT_DATA_PATH = str(_DATA_DIR / "row_data") + "/"
DEFAULT_RESULT_PATH = str(_DATA_DIR / "result") + "/"
DEFAULT_PEAK_THRESHOLD = 10

# --- バッチ処理設定 ---
_BLUR_OVERLAP = 4  # 3Dガウスブラー（sigma=1）に必要なオーバーラップ枚数


def _auto_batch_size(h: int, w: int) -> int:
    """GPUのVRAM空き容量に基づいてバッチサイズを自動決定"""
    try:
        free_mem, _ = cp.cuda.Device().mem_info
        # 空きVRAMの40%を使用（フラグメンテーションとオーバーヘッドを考慮）
        usable = free_mem * 0.4
        bytes_per_image = h * w * 4  # float32
        # ピーク時は同時に2つの大きな配列が存在する（入力+出力）
        batch = int(usable / (3 * bytes_per_image))
        return max(1, min(batch, 512))
    except Exception:
        return 256


def create_gauss_window(h, w, sigma_scale=6):
    """ガウス窓を作成（GPU版、X方向のみ、Y方向は均一）"""
    cx = w // 2
    sigma_x = w / sigma_scale

    x = cp.arange(w, dtype=cp.float32) - cx
    gx = cp.exp(-x**2 / (2 * sigma_x**2))

    gauss = cp.tile(gx, (h, 1))
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
    画像処理を実行する（GPU版・バッチ処理対応）

    大量の画像をバッチに分割してGPU処理し、VRAMの使用量を抑える。
    処理フロー:
      1. 画像をCPUに読み込み
      2. 背景（中央値）をCPUで計算
      3. diff_xのグローバル最大値を軽量バッチで計算
      4-5. 背景差分→横方向差分→強調→ガウス窓をバッチ処理し、CPUに退避
      6-7. 3Dガウスブラー→コントラスト正規化→ピーク検出をオーバーラップ付きバッチ処理

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
            progress_callback(step, total_steps, f"[GPU] {message}")

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
    images_np = np.stack(img_list)
    del img_list

    n_images, h, w = images_np.shape
    w_diff = w - 1

    # バッチサイズを自動決定
    batch_size = _auto_batch_size(h, w)

    # Step 2: 背景画像（中央値）をCPUで省メモリ計算
    # 全画像をスタックせず、行チャンク単位で中央値を求める
    report(2, "背景画像を計算中...")
    bg_image_cpu = np.empty((h, w), dtype=np.float32)
    ROW_CHUNK = 64
    for row_start in range(0, h, ROW_CHUNK):
        row_end = min(row_start + ROW_CHUNK, h)
        bg_image_cpu[row_start:row_end] = np.median(
            images_np[:, row_start:row_end, :], axis=0
        ).astype(np.float32)
    bg_gpu = cp.asarray(bg_image_cpu)
    del bg_image_cpu

    # Step 3: diff_xのグローバル最大値を計算（軽量バッチパス）
    # 強調処理のガンマ補正に全画像共通の正規化係数が必要
    report(3, "前処理パラメータを計算中...")
    global_max = 0.0
    for i in range(0, n_images, batch_size):
        end = min(i + batch_size, n_images)
        batch = cp.asarray(images_np[i:end])
        sub_bg = cp.maximum(batch - bg_gpu, 0)
        del batch
        diff_x = cp.abs(sub_bg[:, :, 1:] - sub_bg[:, :, :-1])
        del sub_bg
        batch_max = float(diff_x.max())
        global_max = max(global_max, batch_max)
        del diff_x
        cp.get_default_memory_pool().free_all_blocks()

    if global_max == 0:
        global_max = 1.0
    inv_max = cp.float32(1.0 / global_max)

    # Step 4-5: 背景差分→横方向差分→強調→ガウス窓をバッチ処理
    # 結果はCPU RAMに退避
    gauss_window = create_gauss_window(h, w_diff, sigma_scale=6)
    gausswin_cpu = np.empty((n_images, h, w_diff), dtype=np.float32)

    for i in range(0, n_images, batch_size):
        end = min(i + batch_size, n_images)
        report(4, f"横方向差分と強調処理中... ({end}/{n_images})")

        batch = cp.asarray(images_np[i:end])
        sub_bg = cp.maximum(batch - bg_gpu, 0)
        del batch

        diff_x = cp.abs(sub_bg[:, :, 1:] - sub_bg[:, :, :-1])
        del sub_bg

        enhanced = cp.power(diff_x * inv_max, cp.float32(0.7)) * 255
        del diff_x

        report(5, f"ガウス窓を適用中... ({end}/{n_images})")
        gausswin_batch = cp.minimum(enhanced * gauss_window, 255)
        del enhanced

        gausswin_cpu[i:end] = cp.asnumpy(gausswin_batch)
        del gausswin_batch
        cp.get_default_memory_pool().free_all_blocks()

    # ここまでで不要になったデータを解放
    del gauss_window, bg_gpu, images_np
    cp.get_default_memory_pool().free_all_blocks()

    # Step 6-7: 3Dガウスブラー→コントラスト正規化→ピーク検出
    # オーバーラップ付きバッチ処理（sigma=1のスタック方向ブラーのため隣接画像が必要）
    # プリフェッチパイプライン: GPU計算中に次バッチのCPU→GPU転送を並行実行
    peak_result_cpu = np.zeros((n_images, h, w_diff), dtype=np.uint8)

    def _prefetch_chunk(gausswin_cpu, load_start, load_end):
        """次のバッチをGPUに転送（バックグラウンドスレッドで実行）"""
        return cp.asarray(gausswin_cpu[load_start:load_end])

    def _calc_load_range(batch_start, batch_end):
        """オーバーラップ付きの読み込み範囲を計算"""
        return max(0, batch_start - _BLUR_OVERLAP), min(n_images, batch_end + _BLUR_OVERLAP)

    with ThreadPoolExecutor(max_workers=1) as prefetch_pool:
        # 最初のバッチを先読み
        first_ls, first_le = _calc_load_range(0, min(batch_size, n_images))
        next_future = prefetch_pool.submit(_prefetch_chunk, gausswin_cpu, first_ls, first_le)

        for i in range(0, n_images, batch_size):
            end = min(i + batch_size, n_images)
            report(6, f"3次元スタックブラーを適用中... ({end}/{n_images})")

            load_start, _ = _calc_load_range(i, end)

            # 先読みしたチャンクを取得（準備完了まで待機）
            chunk = next_future.result()

            # 次のバッチの先読みを開始（現バッチのGPU計算と並行）
            if end < n_images:
                next_end = min(end + batch_size, n_images)
                next_ls, next_le = _calc_load_range(end, next_end)
                next_future = prefetch_pool.submit(_prefetch_chunk, gausswin_cpu, next_ls, next_le)

            # 3Dガウスフィルタ（sigma=(1,7,7): スタック方向1, 空間方向7）
            blurred = gaussian_filter(chunk, sigma=(1, 7, 7))
            del chunk

            # オーバーラップを除去してコア部分を取得
            trim_start = i - load_start
            trim_end = trim_start + (end - i)
            core = blurred[trim_start:trim_end]
            del blurred

            # コントラスト正規化（画像ごと）
            max_vals = cp.max(core, axis=(1, 2), keepdims=True)
            max_vals = cp.where(max_vals == 0, 1, max_vals)
            contrast = core / max_vals * 255
            del core

            # ピーク検出
            report(7, f"ピーク検出を実行中... ({end}/{n_images})")
            bn, bh, bw = contrast.shape

            max_indices = cp.argmax(contrast, axis=2)
            max_values = cp.take_along_axis(
                contrast, max_indices[:, :, cp.newaxis], axis=2
            ).squeeze(axis=2)

            peak_batch = cp.zeros((bn, bh, bw), dtype=cp.uint8)
            valid_mask = max_values >= peak_threshold

            img_idx, row_idx = cp.mgrid[:bn, :bh]
            valid_img = img_idx[valid_mask]
            valid_row = row_idx[valid_mask]
            valid_col = max_indices[valid_mask]

            peak_batch[valid_img, valid_row, valid_col] = 255
            peak_batch[:, :, :-1] |= peak_batch[:, :, 1:]

            peak_result_cpu[i:end] = cp.asnumpy(peak_batch)
            del contrast, max_indices, max_values, peak_batch
            cp.get_default_memory_pool().free_all_blocks()

    del gausswin_cpu

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
    return True


def get_gpu_info() -> dict:
    """GPU情報を取得"""
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
        print(f"GPU未検出: {gpu_info.get('message', 'Unknown error')}")

    result = run_preprocess(progress_callback=print_progress)
    save_peak_results(result["peak_data"], result["image_files"])
    print("完了しました")
