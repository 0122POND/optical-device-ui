"""
単眼画像 → 疑似3D高さマップ推定。
Depth Anything V2 / Apple Depth Pro を切り替え可能。
transformers をラップし、µm 単位の2次元グリッドを返す。
"""

from __future__ import annotations

from typing import List, Optional

import numpy as np
from PIL import Image

import torch


# ---------- Depth Anything V2 ----------
DEPTH_ANYTHING_IDS = {
    "small": "depth-anything/Depth-Anything-V2-Small-hf",
    "base": "depth-anything/Depth-Anything-V2-Base-hf",
    "large": "depth-anything/Depth-Anything-V2-Large-hf",
}

_cached_pipe = None
_cached_pipe_id: Optional[str] = None
_cached_pipe_device: Optional[str] = None

# ---------- Depth Pro ----------
_cached_dpro_model = None
_cached_dpro_processor = None
_cached_dpro_device: Optional[str] = None


def _get_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load_depth_anything(model_size: str, device: str):
    global _cached_pipe, _cached_pipe_id, _cached_pipe_device
    from transformers import pipeline

    model_id = DEPTH_ANYTHING_IDS.get(model_size, DEPTH_ANYTHING_IDS["small"])
    if _cached_pipe is not None and _cached_pipe_id == model_id and _cached_pipe_device == device:
        return _cached_pipe

    _cached_pipe = pipeline("depth-estimation", model=model_id, device=device)
    _cached_pipe_id = model_id
    _cached_pipe_device = device
    return _cached_pipe


def _load_depth_pro(device: str):
    global _cached_dpro_model, _cached_dpro_processor, _cached_dpro_device
    if (
        _cached_dpro_model is not None
        and _cached_dpro_device == device
    ):
        return _cached_dpro_model, _cached_dpro_processor

    from transformers import DepthProForDepthEstimation, DepthProImageProcessor

    _cached_dpro_processor = DepthProImageProcessor.from_pretrained("apple/DepthPro-hf")
    _cached_dpro_model = DepthProForDepthEstimation.from_pretrained("apple/DepthPro-hf")
    _cached_dpro_model.to(device)
    _cached_dpro_model.eval()
    _cached_dpro_device = device
    return _cached_dpro_model, _cached_dpro_processor


def _infer_depth_anything(image: Image.Image, model_size: str, device: str) -> np.ndarray:
    pipe = _load_depth_anything(model_size, device)
    result = pipe(image)
    depth = result["predicted_depth"]
    if hasattr(depth, "detach"):
        depth = depth.detach().cpu().numpy()
    else:
        depth = np.asarray(depth)
    return np.squeeze(depth).astype(np.float32)


def _infer_depth_pro(image: Image.Image, device: str) -> np.ndarray:
    """Depth Pro でメトリック深度(m)を推定し、元画像サイズにリサイズして返す"""
    model, processor = _load_depth_pro(device)
    inputs = processor(images=image, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model(**inputs)
    post = processor.post_process_depth_estimation(
        outputs, target_sizes=[(image.height, image.width)]
    )
    depth = post[0]["predicted_depth"]
    if hasattr(depth, "detach"):
        depth = depth.detach().cpu().numpy()
    else:
        depth = np.asarray(depth)
    return np.squeeze(depth).astype(np.float32)


def image_to_height_grid(
    image: Image.Image,
    height_range: float = 1000.0,
    height_min: float = 0.0,
    invert: bool = False,
    max_size: Optional[int] = 1024,
    model_size: str = "small",
    device: Optional[str] = None,
    clip_percentile: float = 2.0,
    gamma: float = 1.0,
) -> List[List[float]]:
    """
    PIL画像から高さグリッド (µm) を生成する。

    Args:
        model_size: "small" | "base" | "large" (Depth Anything V2)
                    | "depth_pro" (Apple Depth Pro)
    """
    image = image.convert("RGB")
    if max_size is not None and max_size > 0:
        image.thumbnail((max_size, max_size))

    dev = device or _get_device()

    if model_size == "depth_pro":
        depth = _infer_depth_pro(image, dev)
        # Depth Pro はメートル単位 → µm に変換
        depth = depth * 1_000_000.0
    else:
        depth = _infer_depth_anything(image, model_size, dev)

    # A: パーセンタイルクリッピングで外れ値の影響を除く
    p = max(0.0, min(49.0, clip_percentile))
    if p > 0.0:
        dmin = float(np.percentile(depth, p))
        dmax = float(np.percentile(depth, 100.0 - p))
    else:
        dmin, dmax = float(depth.min()), float(depth.max())

    if dmax > dmin:
        norm = np.clip((depth - dmin) / (dmax - dmin), 0.0, 1.0)
    else:
        norm = np.zeros_like(depth, dtype=np.float32)

    # B: ガンマ補正で中間階調を強調
    if gamma > 0 and gamma != 1.0:
        norm = np.power(norm, gamma, dtype=np.float32)

    if invert:
        norm = 1.0 - norm

    height_um = norm * height_range + height_min
    return height_um.tolist()


def height_grid_to_csv_text(grid: List[List[float]]) -> str:
    """Keyence互換CSV文字列（ヘッダーなし、-9999.9=欠損、小数1桁）"""
    lines = []
    for row in grid:
        lines.append(",".join(f"{v:.1f}" for v in row))
    return "\n".join(lines) + "\n"
