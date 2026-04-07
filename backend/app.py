# backend/app.py
from __future__ import annotations

import asyncio
import json
import math
import random
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

# スレッドプール（画像処理用）
executor = ThreadPoolExecutor(max_workers=2)

# ピーク結果のインメモリキャッシュ（PNG encoded bytes）
_result_cache: Dict[str, bytes] = {}
_result_cache_lock = threading.Lock()


@app.get("/data/result/{filename}")
async def serve_cached_result(filename: str):
    """メモリキャッシュから結果画像を配信（キャッシュミス時はディスクフォールバック）"""
    with _result_cache_lock:
        data = _result_cache.get(filename)
    if data is not None:
        media_type = "application/json" if filename.endswith(".json") else "image/png"
        return Response(content=data, media_type=media_type)

    # ディスクフォールバック
    file_path = DATA_DIR / "result" / filename
    if file_path.exists():
        content = file_path.read_bytes()
        media_type = "application/json" if filename.endswith(".json") else "image/png"
        return Response(content=content, media_type=media_type)

    raise HTTPException(status_code=404, detail=f"File not found: {filename}")


IMAGE_EXTS = {".png", ".bmp", ".jpg", ".jpeg", ".tif", ".tiff"}


def _ensure_manifest(d: Path) -> None:
    """manifest.json がなければ画像ファイル一覧から自動生成する"""
    manifest_path = d / "manifest.json"
    if manifest_path.exists():
        return
    files = sorted(
        f.name for f in d.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTS
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
# Utility: sample data generator
# -----------------------------
def generate_coin_data(size: int = 120) -> List[List[Optional[float]]]:
    z_data: List[List[Optional[float]]] = []
    for i in range(size):
        row: List[Optional[float]] = []
        for j in range(size):
            x = (i / (size - 1)) * 2 - 1
            y = (j / (size - 1)) * 2 - 1
            r = math.sqrt(x * x + y * y)

            if r > 1:
                row.append(None)
                continue

            z = 0.0
            z += 0.1 * (1 - r * r)

            rim_inner, rim_outer = 0.80, 0.95
            if rim_inner < r < rim_outer:
                t = (r - rim_inner) / (rim_outer - rim_inner)
                z += 0.03 * (1 - (2 * t - 1) ** 2)

            z += 0.01 * math.sin(20 * r)

            if z < 0:
                z = 0.0

            row.append(z)
        z_data.append(row)
    return z_data


def add_noise(z_data: List[List[Optional[float]]], amplitude: float = 0.1) -> List[List[Optional[float]]]:
    out: List[List[Optional[float]]] = []
    for row in z_data:
        new_row: List[Optional[float]] = []
        for v in row:
            if v is None:
                new_row.append(None)
            else:
                n = (random.random() * 2 - 1) * amplitude
                vv = v + n
                if vv < 0:
                    vv = 0.0
                new_row.append(vv)
        out.append(new_row)
    return out


# -----------------------------
# WebSocket endpoint
# -----------------------------
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    print("WebSocket connected")

    is_running = False
    running_task: Optional[asyncio.Task] = None

    async def stream_once(params: Dict[str, Any]):
        size = int(params.get("size", 120))
        noise = float(params.get("noise", 0.1))

        z = generate_coin_data(size)
        z = add_noise(z, noise)

        payload = {
            "type": "result",
            "zData": z,
            "meta": {
                "size": size,
                "noise": noise,
            },
        }
        await ws.send_text(json.dumps(payload))
        await ws.send_text(json.dumps({"type": "status", "value": "COMPLETE"}))

    async def stream_loop(params: Dict[str, Any]):
        interval_ms = int(params.get("interval_ms", 200))
        while True:
            await stream_once(params)
            await asyncio.sleep(interval_ms / 1000)

    async def run_ai_inference_with_progress(params: Dict[str, Any]):
        """AI推論を実行し、進捗をWebSocketで送信"""
        loop = asyncio.get_event_loop()
        progress_queue: asyncio.Queue = asyncio.Queue()

        def progress_callback(step: int, total: int, message: str, eta_sec: int = None, percent: int = None):
            loop.call_soon_threadsafe(
                progress_queue.put_nowait,
                {"step": step, "total": total, "message": message, "eta_sec": eta_sec, "percent": percent}
            )

        input_dir = params.get("input_dir", str(DATA_DIR / "row_data"))
        output_dir = params.get("output_dir", str(DATA_DIR / "mask_result"))
        threshold = float(params.get("threshold", 0.5))

        def blocking_inference():
            from ai_inference import run_ai_inference
            return run_ai_inference(
                input_dir=input_dir,
                output_dir=output_dir,
                threshold=threshold,
                progress_callback=progress_callback,
            )

        future = loop.run_in_executor(executor, blocking_inference)

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
            # スレッドセーフにキューに追加
            loop.call_soon_threadsafe(
                progress_queue.put_nowait,
                {"step": step, "total": total, "message": message}
            )

        data_path = params.get("data_path", str(DATA_DIR / "row_data") + "/")
        result_path = params.get("result_path", str(DATA_DIR / "result") + "/")
        peak_threshold = int(params.get("peak_threshold", 10))
        use_gpu = params.get("use_gpu", True)
        algorithm = params.get("algorithm", "coin")

        def blocking_preprocess():
            # HDF5が未作成なら初回のみ自動変換（以降の処理が高速化される）
            data_dir = Path(data_path).resolve()
            hdf5_file = data_dir.parent / f"{data_dir.name}.h5"
            if not hdf5_file.exists():
                try:
                    from convert_to_hdf5 import convert_to_hdf5
                    progress_callback(0, 8, "HDF5形式に変換中（初回のみ）...")
                    convert_to_hdf5(
                        str(data_dir),
                        str(hdf5_file),
                        progress_callback=lambda msg: progress_callback(0, 8, msg),
                    )
                except ImportError:
                    pass  # h5pyがなければスキップ

            # use_gpu / algorithm に応じて適切なモジュールを動的にインポート
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

        # インメモリキャッシュに格納（フロントエンドが即座にフェッチ可能に）
        manifest_json = json.dumps({"files": output_files}).encode()
        with _result_cache_lock:
            _result_cache.clear()
            _result_cache["manifest.json"] = manifest_json
            for name, data in result["encoded"].items():
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
            else:
                if use_gpu:
                    from preprocessing_gpu import save_peak_results
                else:
                    from preprocessing_cpu import save_peak_results
            save_peak_results(peak_data, image_files, result_path)
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

            elif cmd == "start":
                is_running = True
                await ws.send_text(json.dumps({"type": "status", "value": "RUNNING"}))
                await stream_once(params)
                is_running = False

            elif cmd == "start_stream":
                if running_task and not running_task.done():
                    await ws.send_text(json.dumps({"type": "info", "message": "Already streaming"}))
                    continue
                is_running = True
                await ws.send_text(json.dumps({"type": "status", "value": "RUNNING"}))
                running_task = asyncio.create_task(stream_loop(params))

            elif cmd == "stop":
                if running_task and not running_task.done():
                    running_task.cancel()
                    try:
                        await running_task
                    except asyncio.CancelledError:
                        pass
                running_task = None
                is_running = False
                await ws.send_text(json.dumps({"type": "status", "value": "READY"}))

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
        if running_task and not running_task.done():
            running_task.cancel()


# -----------------------------
# Health check
# -----------------------------
@app.get("/health")
def health():
    return {"ok": True}


# -----------------------------
# Shutdown endpoint
# -----------------------------
@app.post("/shutdown")
def shutdown():
    """アプリケーション全体をシャットダウンする（stopスクリプトを実行）"""
    import subprocess
    import platform
    import threading
    import time

    # プロジェクトルートディレクトリ（backend/の親）
    project_root = Path(__file__).parent.parent

    def delayed_shutdown():
        """1秒後にstopスクリプトを実行"""
        time.sleep(1)
        system = platform.system()

        if system == "Darwin":  # macOS
            stop_script = project_root / "stop_mac.sh"
            subprocess.run(["bash", str(stop_script)])
        elif system == "Windows":
            stop_script = project_root / "stop_win.bat"
            subprocess.run(["cmd", "/c", str(stop_script)], shell=True)
        else:  # Linux
            stop_script = project_root / "stop_mac.sh"
            subprocess.run(["bash", str(stop_script)])

    # バックグラウンドスレッドで遅延シャットダウン
    thread = threading.Thread(target=delayed_shutdown, daemon=True)
    thread.start()

    return {"ok": True, "message": "Shutting down..."}
