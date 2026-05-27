"""
深度キャリブレーション: Depth Anything (相対深度, 完全) + 干渉縞 (絶対深度, 欠損あり)
→ 欠損のない絶対深度マップを生成する。

1. カメラ画像 → Depth Anything → 相対深度 (H, W)
2. 干渉縞 CSV → 絶対深度 (H2, W2)、-9999.9 / null = 欠損
3. 正規化テンプレートマッチング（NCC）で空間位置合わせ
4. 重なり領域の有効ピクセルで線形回帰 (a, b)
5. 全ピクセルに a * relative + b → 絶対深度 (µm)
"""

from __future__ import annotations

from typing import List, Optional, Tuple

import cv2
import numpy as np
from PIL import Image


def _normalize_for_matching(depth: np.ndarray, mask: Optional[np.ndarray] = None) -> np.ndarray:
    """depth を [0, 255] uint8 に正規化（テンプレートマッチング用）"""
    if mask is not None:
        valid = depth[mask]
        if len(valid) == 0:
            return np.zeros_like(depth, dtype=np.uint8)
        dmin, dmax = valid.min(), valid.max()
    else:
        dmin, dmax = depth.min(), depth.max()
    if dmax - dmin < 1e-9:
        return np.zeros_like(depth, dtype=np.uint8)
    norm = np.clip((depth - dmin) / (dmax - dmin), 0, 1)
    if mask is not None:
        norm[~mask] = 0
    return (norm * 255).astype(np.uint8)


def _find_best_match(
    relative_full: np.ndarray,
    absolute_patch: np.ndarray,
    absolute_mask: np.ndarray,
    rotation_range: int = 5,
) -> Tuple[int, int, float, float]:
    """
    NCC テンプレートマッチングで最適位置と回転を見つける。

    Returns:
        (top_y, left_x, best_angle, best_score)
    """
    ref_img = _normalize_for_matching(relative_full)
    patch_img = _normalize_for_matching(absolute_patch, absolute_mask)

    best_score = -1.0
    best_loc = (0, 0)
    best_angle = 0.0

    for angle in range(-rotation_range, rotation_range + 1):
        if angle == 0:
            rotated = patch_img
            rotated_mask = absolute_mask.astype(np.uint8) * 255
        else:
            h, w = patch_img.shape[:2]
            M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
            rotated = cv2.warpAffine(patch_img, M, (w, h), borderValue=0)
            rotated_mask = cv2.warpAffine(
                absolute_mask.astype(np.uint8) * 255, M, (w, h), borderValue=0
            )

        rh, rw = rotated.shape[:2]
        fh, fw = ref_img.shape[:2]
        if rh > fh or rw > fw:
            scale = min(fh / rh, fw / rw) * 0.95
            rotated = cv2.resize(rotated, None, fx=scale, fy=scale)
            rotated_mask = cv2.resize(rotated_mask, None, fx=scale, fy=scale)

        # 有効ピクセルが少ないパッチは飛ばす
        if np.count_nonzero(rotated_mask > 128) < 100:
            continue

        result = cv2.matchTemplate(ref_img, rotated, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(result)

        if max_val > best_score:
            best_score = max_val
            best_loc = max_loc  # (x, y)
            best_angle = angle

    return best_loc[1], best_loc[0], best_angle, best_score


def calibrate_depth(
    camera_image: Image.Image,
    absolute_grid: List[List[Optional[float]]],
    depth_model_size: str = "base",
    max_size: Optional[int] = 1024,
    rotation_search: int = 5,
) -> dict:
    """
    カメラ画像 + 干渉縞絶対深度 → キャリブレーション済み絶対深度マップ。

    Args:
        camera_image: カメラで撮影した画像 (PIL)
        absolute_grid: 干渉縞由来の絶対深度 2D グリッド (null = 欠損)
        depth_model_size: Depth Anything モデルサイズ
        max_size: 相対深度推定時の最大辺リサイズ
        rotation_search: 回転探索範囲 (±度)

    Returns:
        dict:
            calibrated_grid: 補正済み絶対深度 2D グリッド
            match_score: NCC スコア
            match_position: (y, x)
            match_angle: 回転角度
            scale: a (線形回帰の傾き)
            offset: b (線形回帰のオフセット)
            valid_points: フィッティングに使用した有効ピクセル数
    """
    from depth_inference import image_to_height_grid

    # 1. カメラ画像 → 相対深度マップ（正規化せず raw で取得）
    relative_grid = image_to_height_grid(
        camera_image,
        height_range=1.0,
        height_min=0.0,
        invert=False,
        max_size=max_size,
        model_size=depth_model_size,
        clip_percentile=0,
        gamma=1.0,
    )
    relative = np.array(relative_grid, dtype=np.float32)

    # 2. 干渉縞 → numpy配列 + 有効マスク
    abs_arr = np.array(absolute_grid, dtype=np.float32)
    abs_arr = np.where(np.isnan(abs_arr), -9999.9, abs_arr)
    abs_mask = abs_arr > -9999.0

    # 3. 解像度合わせ（干渉縞をリサイズして相対深度に合わせる）
    rel_h, rel_w = relative.shape
    abs_h, abs_w = abs_arr.shape

    # 干渉縞データを相対深度と同じアスペクト比にリサイズ
    # まずアスペクト比を保って最大限に合うスケールを算出
    scale_y = rel_h / abs_h
    scale_x = rel_w / abs_w
    scale = min(scale_y, scale_x)

    new_h = int(abs_h * scale)
    new_w = int(abs_w * scale)

    abs_resized = cv2.resize(abs_arr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    mask_resized = cv2.resize(
        abs_mask.astype(np.uint8), (new_w, new_h), interpolation=cv2.INTER_NEAREST
    ).astype(bool)

    # 4. テンプレートマッチング
    top_y, left_x, angle, score = _find_best_match(
        relative, abs_resized, mask_resized, rotation_range=rotation_search
    )

    # 5. 回転が必要な場合は回転を適用
    if angle != 0:
        h, w = abs_resized.shape[:2]
        M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        abs_resized = cv2.warpAffine(abs_resized, M, (w, h), borderValue=-9999.9)
        mask_resized = cv2.warpAffine(
            mask_resized.astype(np.uint8), M, (w, h), borderValue=0
        ).astype(bool)

    # 6. 相対深度から干渉縞パッチに対応する領域を切り出し
    #    パッチが画像端をはみ出す場合はパディングで補完
    ph, pw = abs_resized.shape

    # パディング付きで相対深度から干渉縞サイズぴったりの領域を取得
    pad_top = max(0, -top_y)
    pad_left = max(0, -left_x)
    pad_bottom = max(0, (top_y + ph) - rel_h)
    pad_right = max(0, (left_x + pw) - rel_w)

    y1 = max(0, top_y)
    x1 = max(0, left_x)
    y2 = min(rel_h, top_y + ph)
    x2 = min(rel_w, left_x + pw)

    rel_crop = relative[y1:y2, x1:x2]
    if pad_top > 0 or pad_bottom > 0 or pad_left > 0 or pad_right > 0:
        rel_crop = np.pad(
            rel_crop,
            ((pad_top, pad_bottom), (pad_left, pad_right)),
            mode="edge",
        )

    # 干渉縞の有効ピクセルでフィッティング
    rel_vals = rel_crop[mask_resized]
    abs_vals = abs_resized[mask_resized]

    if len(rel_vals) < 10:
        raise ValueError(
            f"有効な重なりピクセルが少なすぎます ({len(rel_vals)} 点)。"
            "画像の対応関係を確認してください。"
        )

    # 7. 線形回帰: absolute = a * relative + b
    a, b = np.polyfit(rel_vals, abs_vals, 1)

    # 8. 干渉縞パッチ全域に適用してから、元の干渉縞解像度に戻す
    calibrated_at_match = a * rel_crop + b
    calibrated_original = cv2.resize(
        calibrated_at_match, (abs_w, abs_h), interpolation=cv2.INTER_LINEAR
    )

    return {
        "calibrated_grid": calibrated_original.tolist(),
        "match_score": float(score),
        "match_position": (int(top_y), int(left_x)),
        "match_angle": float(angle),
        "scale": float(a),
        "offset": float(b),
        "valid_points": int(len(rel_vals)),
        "shape": (abs_h, abs_w),
    }
