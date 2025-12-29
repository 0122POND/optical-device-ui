# backend/app.py
from __future__ import annotations

import asyncio
import json
import math
import random
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware


# -----------------------------
# App / CORS
# -----------------------------
app = FastAPI()

# 開発中はVite(5173)から接続することが多いので許可
# 必要に応じて "http://localhost:5173" などに絞ってOK
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------
# Utility: sample data generator
#   - TS側の generateCoinData/addNoise の代替
# -----------------------------
def generate_coin_data(size: int = 120) -> List[List[Optional[float]]]:
    z_data: List[List[Optional[float]]] = []
    for i in range(size):
        row: List[Optional[float]] = []
        for j in range(size):
            x = (i / (size - 1)) * 2 - 1
            y = (j / (size - 1)) * 2 - 1
            r = math.sqrt(x * x + y * y)

            # 半径1より外はデータなし
            if r > 1:
                row.append(None)
                continue

            z = 0.0

            # 中央のふくらみ
            z += 0.1 * (1 - r * r)

            # 縁（リング状にちょい盛る）
            rim_inner, rim_outer = 0.80, 0.95
            if rim_inner < r < rim_outer:
                t = (r - rim_inner) / (rim_outer - rim_inner)  # 0..1
                z += 0.03 * (1 - (2 * t - 1) ** 2)  # 山型

            # ごく小さい波（雰囲気）
            z += 0.01 * math.sin(20 * r)

            # 0未満は出さない（あなたの要望に合わせて）
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
    print("✅ WebSocket connected")

    # ここは「計測中」などの状態管理に使える
    is_running = False
    running_task: Optional[asyncio.Task] = None

    async def stream_once(params: Dict[str, Any]):
        """
        1回分の結果（zData）を作って送る。
        後でAI推論に差し替えるならこの中を置き換えるのが楽。
        """
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
        # ここで "status" も送ってあげるとフロントが楽
        await ws.send_text(json.dumps({"type": "status", "value": "COMPLETE"}))

    async def stream_loop(params: Dict[str, Any]):
        """
        連続で流したい場合のループ（デモ用）。
        interval_ms ごとに更新して送る。
        """
        interval_ms = int(params.get("interval_ms", 200))
        while True:
            await stream_once(params)
            await asyncio.sleep(interval_ms / 1000)

    try:
        # 接続直後にREADYを送っておく（任意）
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
                # 1回だけ送る（最小）
                is_running = True
                await ws.send_text(json.dumps({"type": "status", "value": "RUNNING"}))
                await stream_once(params)
                is_running = False

            elif cmd == "start_stream":
                # 連続配信（デモ用）
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

            else:
                await ws.send_text(json.dumps({"type": "error", "message": f"Unknown cmd: {cmd}"}))

    except WebSocketDisconnect:
        print("👋 WebSocket disconnected")
        if running_task and not running_task.done():
            running_task.cancel()

# -----------------------------
# Optional: health check（追加で、GPUが使えるかどうかなども確認できると良いかも）
# -----------------------------
@app.get("/health")
def health():
    return {"ok": True}
