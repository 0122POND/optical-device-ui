"""
AI推論モジュール
line-finder-ai の推論ロジックを移植。
干渉縞画像からマスク画像を生成する。
"""

import glob
import os
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


# モデル設定（unetpp_resnet34.yaml に対応）
MODEL_CONFIG = {
    "encoder_name": "resnet34",
    "in_channels": 3,
    "classes": 1,
    "target_size": (1024, 1248),  # (H, W)
}

# モデルファイルパス
MODEL_DIR = Path(__file__).parent / "models"
DEFAULT_CHECKPOINT = MODEL_DIR / "best_model.pth"

# シングルトンでモデルをキャッシュ
_cached_model = None
_cached_device = None


def get_device() -> torch.device:
    """CPU/GPU を自動判定"""
    if torch.cuda.is_available():
        return torch.device("cuda")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    else:
        return torch.device("cpu")


def load_model(checkpoint_path: Optional[str] = None, device: Optional[torch.device] = None) -> tuple:
    """モデルをロード（キャッシュ付き）"""
    global _cached_model, _cached_device

    if device is None:
        device = get_device()

    if checkpoint_path is None:
        checkpoint_path = str(DEFAULT_CHECKPOINT)

    # キャッシュヒット
    if _cached_model is not None and _cached_device == device:
        return _cached_model, device

    model = smp.UnetPlusPlus(
        encoder_name=MODEL_CONFIG["encoder_name"],
        encoder_weights=None,
        in_channels=MODEL_CONFIG["in_channels"],
        classes=MODEL_CONFIG["classes"],
    )

    state = torch.load(checkpoint_path, map_location=device, weights_only=True)
    if "model_state_dict" in state:
        model.load_state_dict(state["model_state_dict"])
    else:
        model.load_state_dict(state)

    model.to(device)
    model.eval()

    _cached_model = model
    _cached_device = device

    return model, device


def get_inference_transform(target_size: tuple):
    """推論用の前処理"""
    return A.Compose([
        A.Resize(height=target_size[0], width=target_size[1]),
        A.Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
        ToTensorV2(),
    ], is_check_shapes=False)


def run_ai_inference(
    input_dir: str,
    output_dir: str,
    threshold: float = 0.5,
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

    progress_callback(2, 6, "AIモデルをロード中...", percent=10)
    model, device = load_model(device=device)

    # Step 3: 入力画像の収集
    progress_callback(3, 6, "入力画像を収集中...", percent=15)
    exts = ["*.bmp", "*.png", "*.jpg", "*.jpeg"]
    image_paths = []
    for ext in exts:
        image_paths.extend(glob.glob(os.path.join(input_dir, ext)))
    image_paths = sorted(image_paths)

    if not image_paths:
        raise ValueError(f"入力画像が見つかりません: {input_dir}")

    # Step 4: 出力ディレクトリ準備
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    os.makedirs(output_dir)

    # Transform
    target_size = MODEL_CONFIG["target_size"]
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
