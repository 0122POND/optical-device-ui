# API仕様書

このドキュメントでは、バックエンド（`backend/app.py`）のAPIについて説明します。

## エンドポイント一覧

| エンドポイント | プロトコル | 説明 |
|--------------|----------|------|
| `/ws` | WebSocket | メイン通信チャネル（画像処理・AI推論） |
| `/health` | HTTP GET | ヘルスチェック |
| `/data/result/{filename}` | HTTP GET | 処理結果（メモリキャッシュ優先・ディスクフォールバック） |
| `/data/mask_result/manifest.json` | HTTP GET | AI推論結果マニフェスト（自動生成） |
| `/data/...` | HTTP GET (静的) | `data/` 配下の静的ファイル配信 |

---

## WebSocket API (`/ws`)

### 接続

```javascript
const ws = new WebSocket(`ws://${window.location.hostname}:8000/ws`);
```

接続成功時、サーバーから以下が送信されます：

```json
{ "type": "status", "value": "READY" }
```

---

## クライアント → サーバー（コマンド）

### `ping` - 疎通確認

```json
{ "cmd": "ping" }
```

**レスポンス:**
```json
{ "type": "pong" }
```

---

### `preprocess` - 画像処理実行

```json
{
  "cmd": "preprocess",
  "params": {
    "peak_threshold": 10,
    "use_gpu": true,
    "algorithm": "coin"
  }
}
```

| パラメータ | 型 | デフォルト | 説明 |
|----------|---|----------|------|
| `peak_threshold` | int | 10 | ピーク検出閾値 |
| `use_gpu` | bool | true | GPU（CuPy）使用フラグ |
| `algorithm` | string | `"coin"` | アルゴリズム種別 |
| `data_path` | string | `data/row_data/` | 入力画像ディレクトリ |
| `result_path` | string | `data/result/` | 出力ディレクトリ |

**`algorithm` の選択肢:**

| 値 | モジュール（GPU/CPU） | 用途 |
|---|---|---|
| `coin` | `preprocessing_gpu.py` / `preprocessing_cpu.py` | コイン計測（標準。CPUは σ=10＋1px膨張） |
| `coin2` | `preprocessing_coin2_gpu.py` / `preprocessing_coin2_cpu.py` | コイン計測（改良版。X方向のみガウス窓） |
| `tgv` | `preprocessing_tgv_gpu.py` / `preprocessing_tgv.py` | TGV正則化（構造別） |
| `elec` / `medical` / `semi` | `preprocessing_gpu.py` / `preprocessing_std_cpu.py` | 電子部品・医療・半導体（標準系。3者は同一処理を共用） |

> 備考: `elec` / `medical` / `semi` は処理内容が同一だったため、GPUは標準の `preprocessing_gpu.py`、CPUは `preprocessing_std_cpu.py`（旧 `preprocessing_elec_cpu.py`）を共用します。`coin` との違いはCPU側の σ 値（1 vs 10）と1px膨張の有無のみです。

※ 初回実行時は `data/row_data.h5` （HDF5キャッシュ）が自動生成され、以降の処理が高速化されます。

**レスポンス（進捗）:**
```json
{
  "type": "progress",
  "step": 3,
  "total": 8,
  "message": "ガウス窓を適用中...",
  "percent": 37
}
```

**レスポンス（完了）:**
```json
{
  "type": "preprocess_complete",
  "files": ["001.png", "002.png", ...],
  "count": 170
}
```

完了通知後、結果画像はインメモリキャッシュに格納され、`/data/result/{filename}` 経由で即座に取得できます。ディスクへの書き込みはバックグラウンドで実行されます。

---

### `ai_inference` - AI推論実行（干渉縞セグメンテーション）

```json
{
  "cmd": "ai_inference",
  "params": {
    "model_type": "resnet34",
    "threshold": 0.5,
    "input_dir": "data/row_data",
    "output_dir": "data/mask_result"
  }
}
```

| パラメータ | 型 | デフォルト | 説明 |
|----------|---|----------|------|
| `model_type` | string | `"resnet34"` | モデル種別（下表） |
| `threshold` | float | 0.5 | 二値化閾値 |
| `input_dir` | string | `data/row_data` | 入力画像ディレクトリ |
| `output_dir` | string | `data/mask_result` | マスク出力先 |

**`model_type` の選択肢（`backend/ai_inference.py` 準拠）:**

`resnet34` / `resnet50` / `resnet101` / `resnet152` / `deeplabv3plus_effv2m` / `segformer_b2` / `unetpp_effv2m` / `unetpp_effv2l` / `unetpp_2_5d`

**レスポンス（進捗）:**
```json
{
  "type": "progress",
  "step": 4,
  "total": 6,
  "message": "推論中...",
  "percent": 66,
  "eta_sec": 12
}
```

**レスポンス（完了）:**
```json
{
  "type": "ai_inference_complete",
  "files": ["001.png", "002.png", ...],
  "count": 170,
  "device": "cuda"
}
```

---

## サーバー → クライアント（メッセージタイプ）

| type | 説明 |
|------|------|
| `status` | ステータス変更（`READY` / `RUNNING` / `COMPLETE`） |
| `progress` | 処理進捗（`step` / `total` / `message` / `percent` / `eta_sec?`） |
| `preprocess_complete` | 画像処理完了 |
| `ai_inference_complete` | AI推論完了 |
| `pong` | ping応答 |
| `error` | エラーメッセージ |

---

## HTTP API

### `GET /health` - ヘルスチェック

```bash
curl http://localhost:8000/health
```

**レスポンス:**
```json
{ "ok": true }
```

---

### `GET /data/result/{filename}` - 処理結果配信

メモリキャッシュ優先で配信し、キャッシュミス時は `data/result/{filename}` のディスクファイルにフォールバックします。`.json` は `application/json`、それ以外は `image/png` として返します。

### `GET /data/mask_result/manifest.json` - マスクマニフェスト

`data/mask_result/` 内の画像ファイル一覧から `manifest.json` を自動生成して返します。

---

## エラーハンドリング

### WebSocket

```json
{
  "type": "error",
  "message": "エラーの説明"
}
```

| エラー例 | 原因 |
|---------|------|
| `Invalid JSON` | 不正なJSON形式 |
| `Unknown cmd: xxx` | 未知のコマンド |
| `Already running` | 処理が既に実行中 |

### HTTP

エラーは FastAPI の標準 `HTTPException` で返却されます（400 / 404 / 500 など）。
