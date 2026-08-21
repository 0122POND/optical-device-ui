# アーキテクチャ概要

このドキュメントでは、Optical Device UI のシステム構成について説明します。

## システム構成図

```
┌────────────────────────────────────────────────────────────────┐
│                          Browser                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              React 19 + Vite Frontend                     │  │
│  │  ┌───────────┐  ┌────────────┐  ┌────────────────────┐   │  │
│  │  │  App.tsx  │  │  utils/    │  │  plotly.js-dist    │   │  │
│  │  │  (UI)     │  │  (前処理)  │  │  (3D / 2D断面)     │   │  │
│  │  └─────┬─────┘  └────────────┘  └────────────────────┘   │  │
│  └────────┼─────────────────────────────────────────────────┘  │
│           │  WebSocket (/ws) / HTTP (REST + 静的配信)            │
└───────────┼─────────────────────────────────────────────────────┘
            │
┌───────────┼─────────────────────────────────────────────────────┐
│           ▼                                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  FastAPI (backend/app.py)                                │    │
│  │  - WebSocket: preprocess / ai_inference / start / stop    │    │
│  │  - HTTP: /depth_from_image  /calibrate_depth  /shutdown   │    │
│  │  - 静的配信 + インメモリ結果キャッシュ                       │    │
│  └────────────┬─────────────────────────────────────────────┘    │
│               │ ThreadPoolExecutor                              │
│               ▼                                                 │
│  ┌──────────────────────┐  ┌──────────────────────────────┐     │
│  │  preprocessing_*.py  │  │  ai_inference.py             │     │
│  │  (CPU / GPU 動的選択)  │  │  (PyTorch + SMP モデル群)   │     │
│  │  coin / coin2 / tgv  │  │                              │     │
│  │  elec / medical /    │  └──────────────────────────────┘     │
│  │  semi                │  ┌──────────────────────────────┐     │
│  └──────────────────────┘  │  depth_inference.py          │     │
│                            │  depth_calibration.py        │     │
│                            │  (Depth Anything V2)         │     │
│                            └──────────────────────────────┘     │
│                       Python Backend                            │
└─────────────────────────────────────────────────────────────────┘
```

## コンポーネント詳細

### フロントエンド（`frontend/src/`）

| ファイル | 責務 |
|--------------|------|
| `App.tsx` | UI、状態管理、WebSocket通信、Plotly描画、断層抽出、距離計測、計測履歴 |
| `utils/surface.ts` | デモ用パラメトリック3Dサーフェス生成 |
| `utils/pointCloud.ts` | マスク/ピーク画像群（PNG/BMP）から3D点群を構築 |
| `utils/stream.ts` | 蛇行順序での漸進的レンダリング |
| `utils/csv.ts` | CSVエクスポート / インポート |

### バックエンド（`backend/`）

| ファイル | 責務 |
|--------------|------|
| `app.py` | FastAPI エントリ。WebSocket / HTTP / 静的配信を統合 |
| `ai_inference.py` | PyTorch + segmentation-models-pytorch によるマスク推論 |
| `convert_to_hdf5.py` | BMP群を HDF5 に一括変換（初回キャッシュ生成） |
| `depth_inference.py` | Depth Anything V2 による単眼深度推定 |
| `depth_calibration.py` | 単眼深度 + 干渉縞CSV の位置合わせ・絶対深度化 |
| `preprocessing_cpu.py` / `preprocessing_gpu.py` | 標準コイン計測パイプライン（CPU / CuPy） |
| `preprocessing_std_cpu.py` | 標準系CPU（elec/medical/semi共用。coinとの差はσ=1・膨張なし） |
| `preprocessing_coin2_*.py` | コイン計測パイプライン改良版 |
| `preprocessing_tgv*.py` | TGV正則化バリアント |
| `models/` | 学習済みモデル（重み）格納 |

### ツール群（`tools/`）

実験・解析用のスタンドアロンスクリプト。WebSocket API には組み込まれていない。

| ファイル | 用途 |
|--------------|------|
| `interpolate_masks.py` | 干渉縞マスクのスプライン補間（行ごとX重心 + スライス間平滑化） |
| `interpolate_scan.py` | Keyence互換CSV の列方向（走査方向）欠損補間 |
| `interpolate_2d.py` | 2次元補間 |
| `remove_outliers.py` | MAD ベース外れ値除去 |
| `analyze_csv_quality.py` | CSV 品質可視化（matplotlib Agg バックエンド） |
| `compare_spline_all.py` | 補間手法の比較 |
| `compare_validity.py` | 有効率比較 |
| `denoise_dominant_plane.py` | 支配平面ベースのノイズ除去 |
| `detect_fringes_classical.py` | 古典的（非AI）干渉縞検出 |
| `downsample_csv.py` | CSVのランダム間引き |
| `image_to_depth_csv.py` | 画像 → 深度CSV変換 |
| `keyence_to_slices.py` | KeyenceCSV → スライス画像列に変換 |
| `natural_sort_csv.py` | 自然順ソート |
| `register_to_keyence.py` | Keyenceを真値とした RMSE 評価 |

## データフロー

### 通常のデータ取得（干渉縞 → 3D点群）

```
1. ユーザーが「START」クリック（algorithm / use_gpu を選択）
        │
        ▼
2. WebSocket で "preprocess" コマンド送信
        │
        ▼
3. バックエンドが ThreadPoolExecutor 上で画像処理を実行
   - 初回のみ HDF5 変換キャッシュ生成
   - 背景差分 → ガウス窓 → ピーク検出（algorithm に応じたモジュール）
        │
        ▼ 進捗を progress メッセージで随時送信
        │
4. 結果画像を PNG エンコード → インメモリキャッシュへ格納
        │
        ▼
5. preprocess_complete を送信（ディスク書き込みは並行進行）
        │
        ▼
6. フロントエンドが /data/result/* から PNG を取得
        │
        ▼
7. utils/pointCloud.ts で点群構築 → Plotly.js で 3D 描画
```

### AI推論ルート

```
ユーザーが「AI推論」→ ws.send("ai_inference", { model_type })
        │
        ▼
backend/ai_inference.py が PyTorch モデルで全スライスを推論
        │
        ▼
マスク画像をインメモリキャッシュ → ai_inference_complete
        │
        ▼
フロントエンドが /data/mask_result/* から取得 → 点群化
```

### 深度推定ルート（オプショナル）

```
カメラ画像 (HTTP POST /depth_from_image)
        │
        ▼
Depth Anything V2 → Keyence互換CSV
        │
       (+ 既存干渉縞CSV を /calibrate_depth に POST)
        ▼
深度キャリブレーション → 欠損なし絶対深度マップ JSON
```

## 技術選定理由

| 技術 | 選定理由 |
|------|---------|
| **React 19 + TypeScript** | strict 型安全、コンポーネント志向 |
| **Vite 7** | 高速 HMR、ビルド時間短縮 |
| **Plotly.js (dist-min)** | インタラクティブな 3D / 2D 描画、WebGL対応 |
| **FastAPI** | 型ヒント活用、WebSocket と HTTP の同居が容易 |
| **WebSocket** | 進捗ストリーミングと長時間処理に最適 |
| **CuPy / PyTorch (オプション)** | GPU で前処理および AI 推論を高速化 |
| **HDF5 (h5py)** | 大量 BMP の I/O 削減 |
| **ThreadPoolExecutor** | ブロッキング処理を非同期イベントループから分離 |

## ディレクトリ構造の設計意図

```
optical-device-ui/
├── frontend/          # React + Vite。独立してビルド可能
├── backend/           # FastAPI + Python 処理一式
│   ├── app.py
│   ├── ai_inference.py
│   ├── depth_inference.py / depth_calibration.py
│   ├── preprocessing_*.py    # アルゴリズム別バリアント
│   └── models/               # 学習済み重み
├── tools/             # 実験・解析用 CLI スクリプト群
├── data/              # 入力画像 / 結果 / マスク / Keyence 等
│   ├── row_data/
│   ├── result/
│   ├── mask_result/
│   └── surface_keyence/
└── docs/              # ドキュメント
```

- **frontend / backend 分離**: 独立デプロイとビルド最適化が容易
- **preprocessing_*.py の動的 import**: アルゴリズム選択を実行時に切替（CPU/GPU・用途別）
- **tools/ の分離**: アプリ機能とは別に、データ品質検証・前処理実験を行うための CLI スクリプトを集約
- **インメモリキャッシュ**: 処理完了直後の描画レイテンシをディスク I/O から分離
