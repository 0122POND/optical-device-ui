"""
AI推論モジュール
line-finder-ai の推論ロジックを移植。
干渉縞画像からマスク画像を生成する。
"""

import glob
import os
import re
import shutil
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np
from PIL import Image

import torch
import segmentation_models_pytorch as smp
import albumentations as A
from albumentations.pytorch import ToTensorV2


# モデル設定
MODEL_CONFIGS = {
    "resnet34": {
        "architecture": "unetpp",
        "encoder_name": "resnet34",
        "in_channels": 3,
        "classes": 1,
        "target_size": (1024, 1248),  # (H, W)
        "checkpoint": "best_model_resnet34.pth",
    },
    "resnet50": {
        "architecture": "unetpp",
        "encoder_name": "resnet50",
        "in_channels": 3,
        "classes": 1,
        "target_size": (1024, 1248),
        "checkpoint": "best_model_resnet50.pth",
    },
    "resnet101": {
        "architecture": "unetpp",
        "encoder_name": "resnet101",
        "in_channels": 3,
        "classes": 1,
        "target_size": (1024, 1248),
        "checkpoint": "best_model_resnet101.pth",
    },
    "resnet152": {
        "architecture": "unetpp",
        "encoder_name": "resnet152",
        "in_channels": 3,
        "classes": 1,
        "target_size": (1024, 1248),
        "checkpoint": "best_model_resnet152.pth",
    },
    "deeplabv3plus_effv2m": {
        "architecture": "deeplabv3plus",
        "encoder_name": "tu-tf_efficientnetv2_m",
        "in_channels": 3,
        "classes": 1,
        "target_size": (1024, 1248),
        "checkpoint": "best_model_deeplabv3plus_effv2m.pth",
    },
    "segformer_b2": {
        "architecture": "segformer",
        "model_name": "nvidia/segformer-b2-finetuned-ade-512-512",
        "num_labels": 1,
        "target_size": (1024, 1248),
        "checkpoint": "best_model_segformer_b2.pth",
    },
    "unetpp_effv2m": {
        "architecture": "unetpp",
        "encoder_name": "tu-tf_efficientnetv2_m",
        "in_channels": 3,
        "classes": 1,
        "target_size": (1024, 1248),
        "checkpoint": "best_model_unetpp_effv2m.pth",
    },
    "unetpp_effv2l": {
        "architecture": "unetpp",
        "encoder_name": "tu-tf_efficientnetv2_l",
        "in_channels": 3,
        "classes": 1,
        "target_size": (1024, 1248),
        "checkpoint": "best_model_unetpp_effv2l.pth",
    },
    "unetpp_2_5d": {
        "architecture": "unetpp",
        "encoder_name": "resnet34",
        "in_channels": 9,
        "classes": 1,
        "target_size": (1024, 1248),
        "checkpoint": "best_model_unetpp_2_5d.pth",
        "mode": "2.5d",
        "num_adjacent": 1,
    },
}

# モデルファイルパス
MODEL_DIR = Path(__file__).parent / "models"

# シングルトンでモデルをキャッシュ
_cached_model = None
_cached_device = None
_cached_model_type = None


def _build_segformer(model_name: str, num_labels: int) -> torch.nn.Module:
    """SegFormer を UnetPlusPlus と同じ (B,1,H,W) logits を返すラッパーで包む"""
    from transformers import SegformerForSemanticSegmentation
    import torch.nn.functional as F

    class SegFormerWrapper(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.model = SegformerForSemanticSegmentation.from_pretrained(
                model_name, num_labels=num_labels, ignore_mismatched_sizes=True
            )

        def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
            logits = self.model(pixel_values=pixel_values).logits
            return F.interpolate(
                logits,
                size=pixel_values.shape[2:],
                mode="bilinear",
                align_corners=False,
            )

    return SegFormerWrapper()


def get_device() -> torch.device:
    """CPU/GPU を自動判定"""
    if torch.cuda.is_available():
        return torch.device("cuda")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    else:
        return torch.device("cpu")


def load_model(model_type: str = "resnet34", device: Optional[torch.device] = None) -> tuple:
    """モデルをロード（キャッシュ付き）"""
    global _cached_model, _cached_device, _cached_model_type

    if model_type not in MODEL_CONFIGS:
        raise ValueError(f"未対応のモデルタイプ: {model_type}")

    if device is None:
        device = get_device()

    # キャッシュヒット（同じモデルタイプ・同じデバイスの場合）
    if _cached_model is not None and _cached_device == device and _cached_model_type == model_type:
        return _cached_model, device

    config = MODEL_CONFIGS[model_type]
    checkpoint_path = str(MODEL_DIR / config["checkpoint"])
    architecture = config.get("architecture", "unetpp")

    if architecture == "unetpp":
        model = smp.UnetPlusPlus(
            encoder_name=config["encoder_name"],
            encoder_weights=None,
            in_channels=config["in_channels"],
            classes=config["classes"],
        )
    elif architecture == "deeplabv3plus":
        model = smp.DeepLabV3Plus(
            encoder_name=config["encoder_name"],
            encoder_weights=None,
            in_channels=config["in_channels"],
            classes=config["classes"],
        )
    elif architecture == "segformer":
        model = _build_segformer(config["model_name"], config["num_labels"])
    else:
        raise ValueError(f"未対応のアーキテクチャ: {architecture}")

    # segformer は HuggingFace 重みも含むため weights_only=False が必要な場合あり
    try:
        state = torch.load(checkpoint_path, map_location=device, weights_only=True)
    except Exception:
        state = torch.load(checkpoint_path, map_location=device, weights_only=False)
    if "model_state_dict" in state:
        model.load_state_dict(state["model_state_dict"])
    else:
        model.load_state_dict(state)

    model.to(device)
    model.eval()

    _cached_model = model
    _cached_device = device
    _cached_model_type = model_type

    return model, device


def get_inference_transform(target_size: tuple):
    """推論用の前処理"""
    return A.Compose([
        A.Resize(height=target_size[0], width=target_size[1]),
        A.Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
        ToTensorV2(),
    ], is_check_shapes=False)


def _load_and_transform_image(path: str, transform) -> torch.Tensor:
    """画像を読み込み、transform適用済みテンソル (3, H, W) を返す"""
    pil_img = Image.open(path).convert("RGB")
    image = np.array(pil_img)
    transformed = transform(image=image)
    return transformed["image"]


def _build_2_5d_tensor(
    image_paths: list,
    idx: int,
    transform,
    num_adjacent: int,
    device: torch.device,
) -> tuple:
    """
    2.5D用: 前後スライスをスタックして (1, 9, H, W) テンソルを作成。
    端のスライスはクランプ（繰り返し）。
    """
    slices = []
    n = len(image_paths)
    for offset in range(-num_adjacent, num_adjacent + 1):
        adj_idx = max(0, min(idx + offset, n - 1))
        t = _load_and_transform_image(image_paths[adj_idx], transform)
        slices.append(t)
    # (num_slices*3, H, W)
    stacked = torch.cat(slices, dim=0)
    # 元画像のサイズ（中央スライス）
    pil_center = Image.open(image_paths[idx])
    orig_w, orig_h = pil_center.size
    return stacked.unsqueeze(0).to(device), orig_w, orig_h


def run_ai_inference(
    input_dir: str,
    output_dir: str,
    threshold: float = 0.5,
    model_type: str = "resnet34",
    progress_callback: Optional[Callable] = None,
) -> dict:
    """
    AI推論を実行し、マスク画像を生成する。

    Args:
        input_dir: 入力画像ディレクトリ（干渉縞画像）
        output_dir: 出力ディレクトリ（マスク画像保存先）
        threshold: 二値化の閾値
        progress_callback: 進捗コールバック(step, total, message)

    Returns:
        dict: output_files, mask_data のリスト
    """
    if progress_callback is None:
        def progress_callback(step, total, message, eta_sec=None, percent=None):
            pass

    # Step 1: デバイス判定・モデルロード
    device = get_device()
    progress_callback(1, 6, f"デバイス検出: {device}", percent=5)

    progress_callback(2, 6, f"AIモデルをロード中... ({model_type})", percent=10)
    model, device = load_model(model_type=model_type, device=device)

    # Step 3: 入力画像の収集
    progress_callback(3, 6, "入力画像を収集中...", percent=15)
    exts = ["*.bmp", "*.png", "*.jpg", "*.jpeg"]
    image_paths = []
    for ext in exts:
        image_paths.extend(glob.glob(os.path.join(input_dir, ext)))
    # ファイル名内の数字で数値順（自然順）ソート。
    # 辞書式だと img_10 が img_2 より前に来てスライス順が壊れる（preprocessing側と統一）。
    image_paths = sorted(
        image_paths,
        key=lambda p: int(
            (re.search(r"img_(\d+)", os.path.basename(p))
             or re.search(r"(\d+)", os.path.basename(p))).group(1)
        ),
    )

    if not image_paths:
        raise ValueError(f"入力画像が見つかりません: {input_dir}")

    # Step 4: 出力ディレクトリ準備
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    os.makedirs(output_dir)

    # Transform
    target_size = MODEL_CONFIGS[model_type]["target_size"]
    transform = get_inference_transform(target_size)

    # Step 5: 推論実行
    total_images = len(image_paths)
    output_files = []
    mask_data = []
    inference_start_time = None

    with torch.no_grad():
        for idx, img_path in enumerate(image_paths):
            import time as _time
            if idx == 0:
                inference_start_time = _time.time()

            # 残り時間の推定
            eta_sec = None
            if idx > 0 and inference_start_time is not None:
                elapsed = _time.time() - inference_start_time
                avg_per_image = elapsed / idx
                remaining = avg_per_image * (total_images - idx)
                eta_sec = round(remaining)

            eta_str = ""
            if eta_sec is not None:
                if eta_sec >= 60:
                    eta_str = f" (残り約{eta_sec // 60}分{eta_sec % 60}秒)"
                else:
                    eta_str = f" (残り約{eta_sec}秒)"

            # 推論は全体の15%〜90%を占める
            inference_percent = 15 + int((idx + 1) / total_images * 75)

            progress_callback(
                4, 6,
                f"AI推論中... ({idx + 1}/{total_images}){eta_str}",
                eta_sec,
                percent=inference_percent,
            )

            config = MODEL_CONFIGS[model_type]
            is_2_5d = config.get("mode") == "2.5d"

            if is_2_5d:
                num_adjacent = config.get("num_adjacent", 1)
                image_tensor, orig_w, orig_h = _build_2_5d_tensor(
                    image_paths, idx, transform, num_adjacent, device
                )
            else:
                pil_img = Image.open(img_path).convert("RGB")
                orig_w, orig_h = pil_img.size
                image = np.array(pil_img)
                transformed = transform(image=image)
                image_tensor = transformed["image"].unsqueeze(0).to(device)

            output = model(image_tensor)
            pred_prob = torch.sigmoid(output).squeeze(0).squeeze(0).cpu().numpy()

            # 元画像サイズにクロップ
            pred_prob_crop = pred_prob[:orig_h, :orig_w]

            # 二値マスク生成
            binary_mask = (pred_prob_crop > threshold).astype(np.uint8) * 255

            # 保存
            base = os.path.splitext(os.path.basename(img_path))[0]
            out_name = f"{base}_mask.png"
            out_path = os.path.join(output_dir, out_name)
            Image.fromarray(binary_mask).save(out_path)

            output_files.append(out_name)
            mask_data.append(binary_mask)

    # Step 6: manifest.json 生成
    progress_callback(5, 6, "manifest.json を生成中...", percent=92)
    import json
    manifest = {"files": output_files}
    manifest_path = os.path.join(output_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # PNGエンコード（メモリキャッシュ用）
    progress_callback(6, 6, "結果を準備中...", percent=95)
    encoded = {}
    for i, name in enumerate(output_files):
        _, buf = cv2.imencode(".png", mask_data[i])
        encoded[name] = buf.tobytes()

    return {
        "output_files": output_files,
        "mask_data": mask_data,
        "encoded": encoded,
        "device": str(device),
        "total_images": total_images,
    }
