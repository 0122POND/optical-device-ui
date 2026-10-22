# backend/app.py
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

import depth_export  # サブピクセル深さとメタデータの書き出し（backend/ 内のモジュール）

# 同一ディレクトリのモジュールをインポートできるようにパスを追加
sys.path.insert(0, str(Path(__file__).parent))


# -----------------------------
# App / CORS
# -----------------------------
app = FastAPI()

# 開発中はVite(5173)から接続することが多いので許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# backendディレクトリから実行されることを想定し、親ディレクトリのdataを参照
DATA_DIR = Path(__file__).parent.parent / "data"


def _data_subpath(value: Any, default: Path) -> str:
    """WebSocket で受け取ったフォルダ指定を data/ 配下に限定して絶対パスで返す。

    出力先は処理の冒頭で中身ごと削除されるため（AI推論の shutil.rmtree など）、
    クライアントから任意のパスを受け付けると data/ 外のフォルダを消しかねない。
    判定は ".." を畳んだ見かけのパスで行い、シンボリックリンクはたどらない
    （data/row_data を外付けドライブへのリンクにしている場合などを拒否しないため）。
    """
    raw = default if value in (None, "") else Path(str(value))
    base = Path(os.path.normpath(os.path.abspath(DATA_DIR)))
    target = Path(os.path.normpath(os.path.abspath(raw if raw.is_absolute() else DATA_DIR / raw)))
    if target != base and base not in target.parents:
        raise ValueError(f"data/ 配下以外のフォルダは指定できません: {raw}")
    return str(target)


def _preprocess_note(algorithm: str, use_gpu: bool, has_depth: bool) -> Optional[str]:
    """メタデータに残す注意書き（同じデータでも結果が変わる条件などを利用者に知らせる）"""
    notes = []
    if algorithm == "coin":
        notes.append(
            "coin は CPU（掃引方向σ=10）と GPU（σ=1）でブラーが異なり、同じデータでも高さが変わる"
        )
    if not has_depth:
        notes.append("この前処理はサブピクセルの深さを出さないため、結果画像の重心から深さを求める")
    return " / ".join(notes) or None


def _natural_key(name: str):
    """img_2 < img_10 < img_200 < img_1000 の順に並べるキー（数字部分を数値で比較）"""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]

# スレッドプール（画像処理用）
executor = ThreadPoolExecutor(max_workers=2)


class WorkerCancelled(Exception):
    """WebSocket切断時に、進捗コールバック経由でワーカースレッドの重い処理を
    協調的に中断するための内部例外（スレッドは外部から強制終了できないため）。"""

# ピーク結果のインメモリキャッシュ（PNG encoded bytes）
_result_cache: Dict[str, bytes] = {}
_result_cache_lock = threading.Lock()


def _media_type(filename: str) -> str:
    if filename.endswith(".json"):
        return "application/json"
    if filename.endswith(".f32"):
        return "application/octet-stream"  # サブピクセル深さ（depth_export 参照）
    return "image/png"


@app.get("/data/result/{filename}")
async def serve_cached_result(filename: str):
    """メモリキャッシュから結果画像を配信（キャッシュミス時はディスクフォールバック）"""
    with _result_cache_lock:
        data = _result_cache.get(filename)
    if data is not None:
        return Response(content=data, media_type=_media_type(filename))

    # ディスクフォールバック
    file_path = DATA_DIR / "result" / filename
    if file_path.exists():
        return Response(content=file_path.read_bytes(), media_type=_media_type(filename))

    raise HTTPException(status_code=404, detail=f"File not found: {filename}")


IMAGE_EXTS = {".png", ".bmp", ".jpg", ".jpeg", ".tif", ".tiff"}


def _ensure_manifest(d: Path) -> None:
    """manifest.json がなければ画像ファイル一覧から自動生成する"""
    manifest_path = d / "manifest.json"
    if manifest_path.exists():
        return
    # 辞書順だと img_1000 が img_200 より前に来てスライス順が崩れるため自然順で並べる
    files = sorted(
        (f.name for f in d.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_EXTS),
        key=_natural_key,
    )
    if not files:
        return
    manifest_path.write_text(json.dumps({"files": files}, ensure_ascii=False, indent=2))


@app.get("/data/mask_result/manifest.json")
async def serve_mask_manifest():
    """mask_result フォルダの manifest.json を自動生成して返す"""
    mask_dir = DATA_DIR / "mask_result"
    if not mask_dir.is_dir():
        raise HTTPException(status_code=404, detail="mask_result フォルダが見つかりません")
    _ensure_manifest(mask_dir)
    manifest_path = mask_dir / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="mask_result 内に画像ファイルがありません")
    return Response(content=manifest_path.read_bytes(), media_type="application/json")


# 静的ファイル配信（キャッシュルートより後に配置し、/data/result/* はキャッシュ優先）
app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")


# -----------------------------
# WebSocket endpoint
# -----------------------------
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    print("WebSocket connected")

    is_running = False
    # 切断時にワーカースレッド（AI推論・前処理）を協調的に中断するためのフラグ。
    # 進捗コールバック内で is_set() を確認し、立っていれば WorkerCancelled を送出する。
    cancel_event = threading.Event()

    async def run_ai_inference_with_progress(params: Dict[str, Any]):
        """AI推論を実行し、進捗をWebSocketで送信"""
        loop = asyncio.get_event_loop()
        progress_queue: asyncio.Queue = asyncio.Queue()

        def progress_callback(step: int, total: int, message: str, eta_sec: int = None, percent: int = None):
            # 切断済みなら次のチェックポイントで処理を中断（CPU/GPUの空回しを防ぐ）
            if cancel_event.is_set():
                raise WorkerCancelled()
            loop.call_soon_threadsafe(
                progress_queue.put_nowait,
                {"step": step, "total": total, "message": message, "eta_sec": eta_sec, "percent": percent}
            )

        input_dir = _data_subpath(params.get("input_dir"), DATA_DIR / "row_data")
        output_dir = _data_subpath(params.get("output_dir"), DATA_DIR / "mask_result")
        threshold = float(params.get("threshold", 0.5))
        model_type = params.get("model_type", "resnet34")

        def blocking_inference():
            from ai_inference import run_ai_inference
            return run_ai_inference(
                input_dir=input_dir,
                output_dir=output_dir,
                threshold=threshold,
                model_type=model_type,
                progress_callback=progress_callback,
            )

        future = loop.run_in_executor(executor, blocking_inference)
        # 切断後に誰も await しないと "exception never retrieved" 警告が出るため取得して握る
        future.add_done_callback(lambda f: f.cancelled() or f.exception())

        def _build_progress_msg(progress):
            pct = progress.get("percent") if progress.get("percent") is not None else int((progress["step"] / progress["total"]) * 100)
            msg = {
                "type": "progress",
                "step": progress["step"],
                "total": progress["total"],
                "message": progress["message"],
                "percent": pct,
            }
            if progress.get("eta_sec") is not None:
                msg["eta_sec"] = progress["eta_sec"]
            return msg

        while not future.done():
            try:
                progress = await asyncio.wait_for(progress_queue.get(), timeout=0.1)
                await ws.send_text(json.dumps(_build_progress_msg(progress)))
            except asyncio.TimeoutError:
                pass

        while not progress_queue.empty():
            progress = await progress_queue.get()
            await ws.send_text(json.dumps(_build_progress_msg(progress)))

        result = await asyncio.wrap_future(future)
        output_files = result["output_files"]

        # インメモリキャッシュに格納
        manifest_json = json.dumps({"files": output_files}).encode()
        with _result_cache_lock:
            _result_cache.clear()
            _result_cache["manifest.json"] = manifest_json
            for name, data in result["encoded"].items():
                _result_cache[name] = data

        await ws.send_text(json.dumps({
            "type": "ai_inference_complete",
            "files": output_files,
            "count": len(output_files),
            "device": result["device"],
        }))

    async def run_preprocess_with_progress(params: Dict[str, Any]):
        """画像処理を実行し、進捗をWebSocketで送信"""
        loop = asyncio.get_event_loop()
        progress_queue: asyncio.Queue = asyncio.Queue()

        def progress_callback(step: int, total: int, message: str):
            # 切断済みなら次のチェックポイントで処理を中断（CPU/GPUの空回しを防ぐ）
            if cancel_event.is_set():
                raise WorkerCancelled()
            # スレッドセーフにキューに追加
            loop.call_soon_threadsafe(
                progress_queue.put_nowait,
                {"step": step, "total": total, "message": message}
            )

        # 前処理モジュールは末尾スラッシュ付きのパスを前提にしている
        data_path = _data_subpath(params.get("data_path"), DATA_DIR / "row_data") + "/"
        result_path = _data_subpath(params.get("result_path"), DATA_DIR / "result") + "/"
        peak_threshold = int(params.get("peak_threshold", 10))
        use_gpu = params.get("use_gpu", True)
        algorithm = params.get("algorithm", "coin")

        def blocking_preprocess():
            # use_gpu / algorithm に応じて適切なモジュールを動的にインポート。
            # elec/medical/semi は標準系と同一処理（GPUは preprocessing_gpu、
            # CPUは preprocessing_std_cpu を共用）。coin(=else)のみ CPUが σ=10+膨張で別。
            if algorithm == "tgv":
                if use_gpu:
                    from preprocessing_tgv_gpu import run_preprocess
                else:
                    from preprocessing_tgv import run_preprocess
            elif algorithm == "coin2":
                if use_gpu:
                    from preprocessing_coin2_gpu import run_preprocess
                else:
                    from preprocessing_coin2_cpu import run_preprocess
            elif algorithm == "coin_paper":
                # 論文掲載用（CPU版のみ）
                from preprocessing_coin2_paper_cpu import run_preprocess
            elif algorithm in ("elec", "medical", "semi"):
                if use_gpu:
                    from preprocessing_gpu import run_preprocess
                else:
                    from preprocessing_std_cpu import run_preprocess
            else:
                if use_gpu:
                    from preprocessing_gpu import run_preprocess
                else:
                    from preprocessing_cpu import run_preprocess

            result = run_preprocess(
                data_path=data_path,
                result_path=result_path,
                peak_threshold=peak_threshold,
                progress_callback=progress_callback,
            )

            # メモリ上でPNGエンコード（ワーカースレッド内で実行）
            encoded = {}
            for i, save_name in enumerate(result["output_files"]):
                _, buf = cv2.imencode('.png', result["peak_data"][i])
                encoded[save_name] = buf.tobytes()

            result["encoded"] = encoded
            return result

        # 別スレッドで画像処理を実行
        future = loop.run_in_executor(executor, blocking_preprocess)
        # 切断後に誰も await しないと "exception never retrieved" 警告が出るため取得して握る
        future.add_done_callback(lambda f: f.cancelled() or f.exception())

        # 進捗を監視して送信
        while not future.done():
            try:
                progress = await asyncio.wait_for(progress_queue.get(), timeout=0.1)
                await ws.send_text(json.dumps({
                    "type": "progress",
                    "step": progress["step"],
                    "total": progress["total"],
                    "message": progress["message"],
                    "percent": int((progress["step"] / progress["total"]) * 100)
                }))
            except asyncio.TimeoutError:
                pass

        # 残りの進捗を送信
        while not progress_queue.empty():
            progress = await progress_queue.get()
            await ws.send_text(json.dumps({
                "type": "progress",
                "step": progress["step"],
                "total": progress["total"],
                "message": progress["message"],
                "percent": int((progress["step"] / progress["total"]) * 100)
            }))

        # 結果を取得
        result = await asyncio.wrap_future(future)
        output_files = result["output_files"]

        # サブピクセルの深さと処理条件（depth_grid.f32 / depth_meta.json）。深さを返さない前処理
        # （GPU・TGV・論文用）でも処理条件は残し、フロントは従来どおりPNGから深さを求める
        depth_grid = result.get("depth_grid")
        depth_meta = depth_export.build_meta(
            depth_grid,
            source="preprocess",
            algorithm=algorithm,
            use_gpu=bool(use_gpu),
            peak_threshold=peak_threshold,
            input_dir=data_path,
            files=output_files,
            depth_method=(result.get("depth_info") or {}).get("method"),
            blur=(
                {k: v for k, v in (result.get("depth_info") or {}).items() if k != "method"}
                or None
            ),
            note=_preprocess_note(algorithm, bool(use_gpu), depth_grid is not None),
        )
        depth_files = depth_export.encode(depth_grid, depth_meta)

        # インメモリキャッシュに格納（フロントエンドが即座にフェッチ可能に）
        manifest_json = json.dumps({"files": output_files}).encode()
        with _result_cache_lock:
            _result_cache.clear()
            _result_cache["manifest.json"] = manifest_json
            for name, data in result["encoded"].items():
                _result_cache[name] = data
            for name, data in depth_files.items():
                _result_cache[name] = data

        # フロントエンドに即座に完了通知（ディスク保存を待たない）
        await ws.send_text(json.dumps({
            "type": "preprocess_complete",
            "files": output_files,
            "count": len(output_files)
        }))

        # バックグラウンドでディスクに保存（キャッシュは保存完了後にクリア）
        peak_data = result["peak_data"]
        image_files = result["image_files"]

        def background_save():
            if algorithm == "tgv":
                if use_gpu:
                    from preprocessing_tgv_gpu import save_peak_results
                else:
                    from preprocessing_tgv import save_peak_results
            elif algorithm == "coin2":
                if use_gpu:
                    from preprocessing_coin2_gpu import save_peak_results
                else:
                    from preprocessing_coin2_cpu import save_peak_results
            elif algorithm == "coin_paper":
                from preprocessing_coin2_paper_cpu import save_peak_results
            elif algorithm in ("elec", "medical", "semi"):
                if use_gpu:
                    from preprocessing_gpu import save_peak_results
                else:
                    from preprocessing_std_cpu import save_peak_results
            else:
                if use_gpu:
                    from preprocessing_gpu import save_peak_results
                else:
                    from preprocessing_cpu import save_peak_results
            save_peak_results(peak_data, image_files, result_path)
            # save_peak_results は保存先を空にするので、深さファイルはその後に書く
            for name, data in depth_files.items():
                with open(os.path.join(result_path, name), "wb") as f:
                    f.write(data)
            # キャッシュクリアは次回の処理実行時に行う
            # （フロントエンドがまだフェッチ中の可能性があるため）

        loop.run_in_executor(executor, background_save)

    try:
        await ws.send_text(json.dumps({"type": "status", "value": "READY"}))

        while True:
            msg_text = await ws.receive_text()
            try:
                msg = json.loads(msg_text)
            except json.JSONDecodeError:
                await ws.send_text(json.dumps({"type": "error", "message": "Invalid JSON"}))
                continue

            cmd = msg.get("cmd")
            params = msg.get("params", {}) if isinstance(msg.get("params", {}), dict) else {}

            if cmd == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))

            elif cmd == "preprocess":
                # 画像処理を実行
                if is_running:
                    await ws.send_text(json.dumps({"type": "error", "message": "Already running"}))
                    continue

                is_running = True
                await ws.send_text(json.dumps({"type": "status", "value": "RUNNING"}))

                try:
                    await run_preprocess_with_progress(params)
                    await ws.send_text(json.dumps({"type": "status", "value": "COMPLETE"}))
                except WebSocketDisconnect:
                    raise
                except Exception as e:
                    try:
                        await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
                        await ws.send_text(json.dumps({"type": "status", "value": "READY"}))
                    except (WebSocketDisconnect, RuntimeError):
                        raise WebSocketDisconnect(code=1006)
                finally:
                    is_running = False

            elif cmd == "ai_inference":
                if is_running:
                    await ws.send_text(json.dumps({"type": "error", "message": "Already running"}))
                    continue

                is_running = True
                await ws.send_text(json.dumps({"type": "status", "value": "RUNNING"}))

                try:
                    await run_ai_inference_with_progress(params)
                    await ws.send_text(json.dumps({"type": "status", "value": "COMPLETE"}))
                except WebSocketDisconnect:
                    raise
                except Exception as e:
                    try:
                        await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
                        await ws.send_text(json.dumps({"type": "status", "value": "READY"}))
                    except (WebSocketDisconnect, RuntimeError):
                        raise WebSocketDisconnect(code=1006)
                finally:
                    is_running = False

            else:
                await ws.send_text(json.dumps({"type": "error", "message": f"Unknown cmd: {cmd}"}))

    except WebSocketDisconnect:
        print("WebSocket disconnected")
        # ワーカースレッド（AI推論・前処理）を次のチェックポイントで中断させる
        cancel_event.set()


# -----------------------------
# Health check
# -----------------------------
@app.get("/health")
def health():
    return {"ok": True}
