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

# --- TGV用パラメータ ---
DEFAULT_GAIN = 8.0                  # 信号増幅ゲイン
DEFAULT_CENTER_SEARCH_RADIUS = 50   # 画像中央からの縦線探索範囲(px)
DEFAULT_LINE_WIDTH = 5              # 抽出する縦線の幅(px)
DEFAULT_ERROR_THRESHOLD = 50.0      # 白飛びエラー閾値(平均輝度)
DEFAULT_LINE_THRESHOLD = 50         # 縦線採用の明るさ閾値(0-255)
DEFAULT_DRAW_LINE_WIDTH = 1         # 最終描画の直線太さ(px)
DEFAULT_CROSS_PROFILE_WIDTH = 70    # 横線検知の幅(基準線から左右px)
DEFAULT_EXCLUDE_WIDTH = 3           # 縦線除外幅(基準線中心から左右px)
DEFAULT_SIGMA_BASELINE = 30.0       # ベースライン補正用ガウシアンσ
DEFAULT_NOISE_FLOOR = 3.0           # AGC正規化のノイズフロア
DEFAULT_PEAK_RELATIVE_THRESHOLD = 1.0  # 正規化後の横線判定閾値


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
    """全画像から基準縦線のグローバルX座標を算出する

    Step 2-1 (中央縦線抽出) → Step 2-2 (全画像平均) を統合
    """
    n_images, h, w = sub_bg.shape
    image_center_x = w // 2
    search_left = max(0, image_center_x - center_search_radius)
    search_right = min(w, image_center_x + center_search_radius)

    # 各画像の中央エリアで最も明るい列を検出
    center_roi = sub_bg[:, :, search_left:search_right]
    col_sum = np.sum(center_roi, axis=1)  # (n_images, roi_width)
    local_max_x = np.argmax(col_sum, axis=1)  # (n_images,)
    center_x_per_image = search_left + local_max_x

    # 各画像の基準線X座標を精密に求める
    all_b_values = []
    for i in range(n_images):
        if error_mask[i]:
            continue

        cx = int(center_x_per_image[i])
        ll = max(0, cx - line_width)
        rr = min(w, cx + line_width + 1)

        # 縦線領域のみを抽出
        vline_strip = sub_bg[i, :, ll:rr]  # (h, strip_width)

        # 各行のピーク位置（ストリップ内のローカル座標）
        max_idx_local = np.argmax(vline_strip, axis=1)  # (h,)
        max_val = vline_strip[np.arange(h), max_idx_local]  # (h,)

        # 閾値を超える行のみ採用
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
    exclude_width: int,
    sigma_baseline: float,
    noise_floor: float,
    peak_relative_threshold: float,
) -> np.ndarray:
    """基準線キャンバスに横線交点の穴をあける（AGC正規化版）

    縦線中心を除外した横方向プロファイルを算出し、
    DC除去 → AGC正規化 → 相対閾値判定で横線位置を検出する。
    """
    h, w = sub_bg_slice.shape

    # 1. 横方向プロファイル（縦線中心を除外）
    left_start = max(0, global_b - cross_profile_width)
    left_end = max(0, global_b - exclude_width)
    right_start = min(w, global_b + exclude_width + 1)
    right_end = min(w, global_b + cross_profile_width + 1)

    left_region = sub_bg_slice[:, left_start:left_end].astype(np.float32)
    right_region = sub_bg_slice[:, right_start:right_end].astype(np.float32)

    if left_region.shape[1] > 0 and right_region.shape[1] > 0:
        profile = np.mean(
            np.concatenate([left_region, right_region], axis=1), axis=1
        )
    elif left_region.shape[1] > 0:
        profile = np.mean(left_region, axis=1)
    elif right_region.shape[1] > 0:
        profile = np.mean(right_region, axis=1)
    else:
        return canvas.copy()

    # 2. ベースライン補正（DC除去）
    profile_baseline = gaussian_filter1d(profile, sigma=sigma_baseline)
    profile_ac = profile - profile_baseline

    # 3. AGC正規化（エンベロープで割り算）
    profile_envelope = gaussian_filter1d(np.abs(profile_ac), sigma=sigma_baseline)
    profile_normalized = profile_ac / (profile_envelope + noise_floor)

    # 4. 相対閾値で横線行を検出し穴あけ
    result = canvas.copy()
    cut_indices = np.where(profile_normalized > peak_relative_threshold)[0]
    result[cut_indices, :] = 0

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
    exclude_width: int = DEFAULT_EXCLUDE_WIDTH,
    sigma_baseline: float = DEFAULT_SIGMA_BASELINE,
    noise_floor: float = DEFAULT_NOISE_FLOOR,
    peak_relative_threshold: float = DEFAULT_PEAK_RELATIVE_THRESHOLD,
) -> dict:
    """
    TGV用画像処理を実行する（CPU版）

    背景除算 → 中央縦線検出 → 基準線フィッティング → AGC正規化による穴あけ

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
        exclude_width: 縦線除外幅(基準線中心から左右px)
        sigma_baseline: ベースライン補正用ガウシアンσ
        noise_floor: AGC正規化のノイズフロア
        peak_relative_threshold: 正規化後の横線判定閾値

    Returns:
        {"peak_data": np.ndarray, "image_files": list, "output_files": list}
    """
    total_steps = 6

    def report(step: int, message: str):
        if progress_callback:
            progress_callback(step, total_steps, f"[CPU/TGV] {message}")

    # Step 1: 画像の並列読み込み
    report(1, "画像を読み込み中...")
    image_files = _sort_image_files(
        [f for f in os.listdir(data_path) if f.lower().endswith((".bmp", ".png"))]
    )

    if not image_files:
        raise ValueError("画像が見つかりません")

    paths = [os.path.join(data_path, f) for f in image_files]
    with ThreadPoolExecutor() as executor:
        img_list = list(executor.map(_load_image, paths))

    images = np.stack(img_list)
    del img_list
    n_images, h, w = images.shape

    # Step 2: 中央値画像（マスター背景）の計算
    report(2, "背景画像を計算中...")
    median_bg = np.median(images, axis=0).astype(np.float32)

    # Step 3: 背景除算による信号抽出
    report(3, "背景除算による信号抽出中...")
    ratio = (images + 1.0) / (median_bg + 1.0)
    signal = 1.0 - ratio
    sub_bg = np.clip(signal * 255.0 * gain, 0, 255).astype(np.uint8)
    del images, median_bg, ratio, signal

    # Step 4: エラー画像の検出 & 基準線X座標の算出
    report(4, "中央縦線を検出中...")
    mean_brightness = np.mean(sub_bg, axis=(1, 2))
    error_mask = mean_brightness > error_threshold

    global_b = _compute_global_reference_x(
        sub_bg, error_mask, center_search_radius, line_width, line_threshold
    )

    # Step 5: 基準線キャンバス作成 & 穴あけ処理
    report(5, "基準線フィッティングと穴あけ処理中...")

    left_b = max(0, global_b - draw_line_width // 2)
    right_b = min(w, global_b + draw_line_width // 2 + 1)

    # 基準線テンプレート（全画像共通）
    base_canvas = np.zeros((h, w), dtype=np.uint8)
    base_canvas[:, left_b:right_b] = 255

    final_data = np.zeros((n_images, h, w), dtype=np.uint8)

    for i in range(n_images):
        if error_mask[i]:
            continue
        final_data[i] = _punch_holes(
            sub_bg[i],
            base_canvas,
            global_b,
            cross_profile_width,
            exclude_width,
            sigma_baseline,
            noise_floor,
            peak_relative_threshold,
        )

    del sub_bg

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

    # 既存の結果ファイルをクリア
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

    print("TGV mode (CPU)")
    result = run_preprocess(progress_callback=print_progress)
    save_peak_results(result["peak_data"], result["image_files"])
    print("完了しました")
