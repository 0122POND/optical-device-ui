import os
import re
import json
import numpy as np
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional, List

import cv2
import cupy as cp
from scipy.signal import find_peaks
from scipy.ndimage import gaussian_filter1d

# --- デフォルト設定 ---
_DATA_DIR = Path(__file__).parent.parent / "data"
DEFAULT_DATA_PATH = str(_DATA_DIR / "row_data") + "/"
DEFAULT_RESULT_PATH = str(_DATA_DIR / "result") + "/"

# --- TGV用パラメータ ---
DEFAULT_GAIN = 8.0                  # 信号増幅ゲイン
DEFAULT_CENTER_SEARCH_RADIUS = 50   # 画像中央からの縦線探索範囲(px)
DEFAULT_LINE_WIDTH = 5              # 抽出する縦線の幅(px)
DEFAULT_ERROR_THRESHOLD = 50.0      # 白飛びエラー閾値(平均輝度)
DEFAULT_LINE_THRESHOLD = 50         # 縦線採用の明るさ閾値(0-255)
DEFAULT_DRAW_LINE_WIDTH = 1         # 最終描画の直線太さ(px)
DEFAULT_CROSS_PROFILE_WIDTH = 70    # 横線検知の幅(基準線から左右px)
DEFAULT_HOLE_PROMINENCE = 5.0       # 横線ピークの際立ち度
DEFAULT_MIN_DISTANCE = 15           # 穴の最小間隔(px)
DEFAULT_HOLE_HEIGHT = 7             # 穴の縦幅(px)


def _auto_batch_size(h: int, w: int) -> int:
    """GPUのVRAM空き容量に基づいてバッチサイズを自動決定"""
    try:
        free_mem, _ = cp.cuda.Device().mem_info
        usable = free_mem * 0.4
        bytes_per_image = h * w * 4  # float32
        batch = int(usable / (3 * bytes_per_image))
        return max(1, min(batch, 512))
    except Exception:
        return 256


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


def _sort_image_files(files: list) -> list:
    """画像ファイルをソート（img_NNN形式またはNNN形式に対応）"""
    def sort_key(f):
        m = re.search(r'img_(\d+)', f)
        if m:
            return int(m.group(1))
        m = re.search(r'(\d+)', f)
        if m:
            return int(m.group(1))
        return 0
    return sorted(files, key=sort_key)


def _compute_global_reference_x(
    sub_bg: np.ndarray,
    error_mask: np.ndarray,
    center_search_radius: int,
    line_width: int,
    line_threshold: int,
) -> int:
    """全画像から基準縦線のグローバルX座標を算出する（CPU処理）"""
    n_images, h, w = sub_bg.shape
    image_center_x = w // 2
    search_left = max(0, image_center_x - center_search_radius)
    search_right = min(w, image_center_x + center_search_radius)

    center_roi = sub_bg[:, :, search_left:search_right]
    col_sum = np.sum(center_roi, axis=1)
    local_max_x = np.argmax(col_sum, axis=1)
    center_x_per_image = search_left + local_max_x

    all_b_values = []
    for i in range(n_images):
        if error_mask[i]:
            continue

        cx = int(center_x_per_image[i])
        ll = max(0, cx - line_width)
        rr = min(w, cx + line_width + 1)

        vline_strip = sub_bg[i, :, ll:rr]
        max_idx_local = np.argmax(vline_strip, axis=1)
        max_val = vline_strip[np.arange(h), max_idx_local]

        valid_rows = max_val >= line_threshold
        if np.sum(valid_rows) >= 10:
            x_coords = ll + max_idx_local[valid_rows]
            all_b_values.append(float(np.median(x_coords)))

    if all_b_values:
        return int(np.round(np.mean(all_b_values)))
    return w // 2


def _punch_holes(
    sub_bg_slice: np.ndarray,
    canvas: np.ndarray,
    global_b: int,
    cross_profile_width: int,
    hole_prominence: float,
    min_distance: int,
    hole_height: int,
) -> np.ndarray:
    """基準線キャンバスに横線交点の穴をあける（CPU処理）"""
    h, w = sub_bg_slice.shape

    p_left = max(0, global_b - cross_profile_width)
    p_right = min(w, global_b + cross_profile_width + 1)
    profile = np.mean(sub_bg_slice[:, p_left:p_right].astype(np.float32), axis=1)

    profile_smooth = gaussian_filter1d(profile, sigma=1.5)
    peaks, _ = find_peaks(
        profile_smooth, prominence=hole_prominence, distance=min_distance
    )

    result = canvas.copy()
    for y in peaks:
        y_start = max(0, y - hole_height // 2)
        y_end = min(h, y + hole_height // 2 + 1)
        result[y_start:y_end, :] = 0

    return result


def run_preprocess(
    data_path: str = DEFAULT_DATA_PATH,
    result_path: str = DEFAULT_RESULT_PATH,
    peak_threshold: int = 10,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
    gain: float = DEFAULT_GAIN,
    center_search_radius: int = DEFAULT_CENTER_SEARCH_RADIUS,
    line_width: int = DEFAULT_LINE_WIDTH,
    error_threshold: float = DEFAULT_ERROR_THRESHOLD,
    draw_line_width: int = DEFAULT_DRAW_LINE_WIDTH,
    line_threshold: int = DEFAULT_LINE_THRESHOLD,
    cross_profile_width: int = DEFAULT_CROSS_PROFILE_WIDTH,
    hole_prominence: float = DEFAULT_HOLE_PROMINENCE,
    min_distance: int = DEFAULT_MIN_DISTANCE,
    hole_height: int = DEFAULT_HOLE_HEIGHT,
) -> dict:
    """
    TGV用画像処理を実行する（GPU版・バッチ処理対応）

    背景除算をGPUでバッチ処理し、基準線検出・穴あけはCPUで実行。

    Args:
        data_path: 入力ディレクトリ
        result_path: 出力ディレクトリ
        peak_threshold: 互換性のため保持（TGVでは未使用）
        progress_callback: 進捗コールバック (current_step, total_steps, message)
        gain: 信号増幅ゲイン
        center_search_radius: 画像中央からの縦線探索範囲(px)
        line_width: 抽出する縦線の幅(px)
        error_threshold: 白飛びエラー閾値(平均輝度)
        draw_line_width: 最終描画の直線太さ(px)
        line_threshold: 縦線採用の明るさ閾値
        cross_profile_width: 横線検知幅(基準線から左右px)
        hole_prominence: 横線ピークの際立ち度
        min_distance: 穴の最小間隔(px)
        hole_height: 穴の縦幅(px)

    Returns:
        {"peak_data": np.ndarray, "image_files": list, "output_files": list}
    """
    total_steps = 6

    def report(step: int, message: str):
        if progress_callback:
            progress_callback(step, total_steps, f"[GPU/TGV] {message}")

    # Step 1: 画像の並列読み込み（CPUで読み込み）
    report(1, "画像を読み込み中...")
    image_files = _sort_image_files(
        [f for f in os.listdir(data_path) if f.lower().endswith((".bmp", ".png"))]
    )

    if not image_files:
        raise ValueError("画像が見つかりません")

    paths = [os.path.join(data_path, f) for f in image_files]
    with ThreadPoolExecutor() as executor:
        img_list = list(executor.map(_load_image, paths))

    n_images = len(img_list)
    h, w = img_list[0].shape
    batch_size = _auto_batch_size(h, w)

    # Step 2: 中央値画像（マスター背景）をCPUで省メモリ計算
    report(2, "背景画像を計算中...")
    median_bg_cpu = np.empty((h, w), dtype=np.float32)
    ROW_CHUNK = 64
    for row_start in range(0, h, ROW_CHUNK):
        row_end = min(row_start + ROW_CHUNK, h)
        row_data = np.stack([img[row_start:row_end] for img in img_list])
        median_bg_cpu[row_start:row_end] = np.median(row_data, axis=0).astype(
            np.float32
        )
        del row_data
    bg_gpu = cp.asarray(median_bg_cpu)
    del median_bg_cpu

    # Step 3: 背景除算による信号抽出（GPUバッチ処理）
    report(3, "背景除算による信号抽出中...")
    gain_f32 = cp.float32(255.0 * gain)
    sub_bg_cpu = np.empty((n_images, h, w), dtype=np.uint8)

    for i in range(0, n_images, batch_size):
        end = min(i + batch_size, n_images)
        batch = cp.stack([cp.asarray(img) for img in img_list[i:end]])

        ratio = (batch + 1.0) / (bg_gpu + 1.0)
        signal = 1.0 - ratio
        clipped = cp.clip(signal * gain_f32, 0, 255).astype(cp.uint8)

        sub_bg_cpu[i:end] = cp.asnumpy(clipped)
        del batch, ratio, signal, clipped
        cp.get_default_memory_pool().free_all_blocks()

    del bg_gpu, img_list
    cp.get_default_memory_pool().free_all_blocks()

    # Step 4: エラー画像の検出 & 基準線X座標の算出（CPU）
    report(4, "中央縦線を検出中...")
    mean_brightness = np.mean(sub_bg_cpu, axis=(1, 2))
    error_mask = mean_brightness > error_threshold

    global_b = _compute_global_reference_x(
        sub_bg_cpu, error_mask, center_search_radius, line_width, line_threshold
    )

    # Step 5: 基準線キャンバス作成 & 穴あけ処理（CPU）
    report(5, "基準線フィッティングと穴あけ処理中...")

    left_b = max(0, global_b - draw_line_width // 2)
    right_b = min(w, global_b + draw_line_width // 2 + 1)

    base_canvas = np.zeros((h, w), dtype=np.uint8)
    base_canvas[:, left_b:right_b] = 255

    final_data = np.zeros((n_images, h, w), dtype=np.uint8)

    for i in range(n_images):
        if error_mask[i]:
            continue
        final_data[i] = _punch_holes(
            sub_bg_cpu[i],
            base_canvas,
            global_b,
            cross_profile_width,
            hole_prominence,
            min_distance,
            hole_height,
        )

    del sub_bg_cpu

    # Step 6: 完了
    report(6, "処理完了")

    output_files = []
    for fname in image_files:
        base_name = os.path.splitext(fname)[0]
        save_name = f"{base_name}_tgv_final.png"
        output_files.append(save_name)

    return {
        "peak_data": final_data,
        "image_files": image_files,
        "output_files": output_files,
    }


def save_peak_results(
    peak_data: np.ndarray,
    image_files: List[str],
    result_path: str = DEFAULT_RESULT_PATH,
) -> List[str]:
    """TGV処理結果をディスクに保存する"""
    os.makedirs(result_path, exist_ok=True)

    for old_file in os.listdir(result_path):
        old_path = os.path.join(result_path, old_file)
        if os.path.isfile(old_path):
            os.remove(old_path)

    save_args = []
    output_files = []
    for i, fname in enumerate(image_files):
        base_name = os.path.splitext(fname)[0]
        save_name = f"{base_name}_tgv_final.png"
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

    print("TGV mode (GPU)")
    try:
        device = cp.cuda.Device()
        props = cp.cuda.runtime.getDeviceProperties(device.id)
        name = props["name"].decode() if isinstance(props["name"], bytes) else props["name"]
        mem_gb = props["totalGlobalMem"] / (1024**3)
        print(f"GPU検出: {name} ({mem_gb:.1f} GB)")
    except Exception as e:
        print(f"GPU情報取得エラー: {e}")

    result = run_preprocess(progress_callback=print_progress)
    save_peak_results(result["peak_data"], result["image_files"])
    print("完了しました")
