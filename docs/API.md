# API仕様書

このドキュメントでは、バックエンドのAPIについて説明します。

## エンドポイント一覧

| エンドポイント | プロトコル | 説明 |
|--------------|----------|------|
| `/ws` | WebSocket | メイン通信チャネル |
| `/health` | HTTP GET | ヘルスチェック |

---

## WebSocket API (`/ws`)

### 接続

```javascript
const ws = new WebSocket("ws://localhost:8000/ws");
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
    "data_path": "frontend/public/data/row_data/",
    "result_path": "frontend/public/data/result/",
    "num_images": 170,
    "peak_threshold": 10
  }
}
```

| パラメータ | 型 | デフォルト | 説明 |
|----------|---|----------|------|
| `data_path` | string | `frontend/public/data/row_data/` | 入力画像ディレクトリ |
| `result_path` | string | `frontend/public/data/result/` | 出力画像ディレクトリ |
| `num_images` | int | 170 | 処理する画像数 |
| `peak_threshold` | int | 10 | ピーク検出閾値 |

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
  "files": ["001.bmp", "002.bmp", ...],
  "count": 170
}
```

---

### `start` - 単発データ生成（デモ用）

```json
{
  "cmd": "start",
  "params": {
    "size": 120,
    "noise": 0.1
  }
}
```

| パラメータ | 型 | デフォルト | 説明 |
|----------|---|----------|------|
| `size` | int | 120 | グリッドサイズ |
| `noise` | float | 0.1 | ノイズ振幅 |

**レスポンス:**
```json
{
  "type": "result",
  "zData": [[0.1, 0.2, ...], ...],
  "meta": { "size": 120, "noise": 0.1 }
}
```

---

### `start_stream` - ストリーミング開始（デモ用）

```json
{
  "cmd": "start_stream",
  "params": {
    "size": 120,
    "noise": 0.1,
    "interval_ms": 200
  }
}
```

定期的に `result` メッセージが送信されます。

---

### `stop` - ストリーミング停止

```json
{ "cmd": "stop" }
```

**レスポンス:**
```json
{ "type": "status", "value": "READY" }
```

---

## サーバー → クライアント（メッセージタイプ）

| type | 説明 |
|------|------|
| `status` | ステータス変更（READY / RUNNING / COMPLETE） |
| `progress` | 処理進捗 |
| `result` | データ結果 |
| `preprocess_complete` | 画像処理完了 |
| `pong` | ping応答 |
| `info` | 情報メッセージ |
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

## エラーハンドリング

すべてのエラーは以下の形式で返されます：

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
