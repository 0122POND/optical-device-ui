# backend/app.py
from __future__ import annotations

import asyncio
import json
import math
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# 同一ディレクトリのモジュールをインポートできるようにパスを追加
sys.path.insert(0, str(Path(__file__).parent))

from preprocessing import run_preprocess


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

# 静的ファイル配信（dataディレクトリ）
# backendディレクトリから実行されることを想定し、親ディレクトリのdataを参照
DATA_DIR = Path(__file__).parent.parent / "data"
app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")

# スレッドプール（画像処理用）
executor = ThreadPoolExecutor(max_workers=2)


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

        def blocking_preprocess():
            data_path = params.get("data_path", str(DATA_DIR / "row_data") + "/")
            result_path = params.get("result_path", str(DATA_DIR / "result") + "/")
            num_images = int(params.get("num_images", 170))
            peak_threshold = int(params.get("peak_threshold", 10))

            return run_preprocess(
                data_path=data_path,
                result_path=result_path,
                num_images=num_images,
                peak_threshold=peak_threshold,
                progress_callback=progress_callback
            )

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
        output_files = await asyncio.wrap_future(future)

        await ws.send_text(json.dumps({
            "type": "preprocess_complete",
            "files": output_files,
            "count": len(output_files)
        }))

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
                except Exception as e:
                    await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
                    await ws.send_text(json.dumps({"type": "status", "value": "READY"}))
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
