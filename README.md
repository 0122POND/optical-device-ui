# Optical Device UI

光学デバイスで取得したデータから三次元形状を可視化するWebアプリケーションです。

## 機能

- 光学計測画像の前処理（背景差分、ガウス窓、ピーク検出など）
- 処理結果からの3D点群生成・表示
- リアルタイム進捗表示
- インタラクティブな3Dビューア（回転、ズーム、軸表示切替）
- CSV出力

## 技術スタック

**フロントエンド**
- React 19 + TypeScript
- Plotly.js（3D可視化）
- Vite（ビルドツール）

**バックエンド**
- Python + FastAPI
- WebSocket（リアルタイム通信）
- NumPy / SciPy / Pillow（画像処理）

## 起動手順

### 1. 依存関係のインストール

```bash
# フロントエンド
cd frontend
npm install

# バックエンド（プロジェクトルートで実行）
pip3 install fastapi uvicorn websockets numpy Pillow scipy
```

### 2. 画像データの配置

処理対象の画像を以下に配置してください：

```
frontend/public/data/row_data/
├── 001.bmp
├── 002.bmp
├── ...
└── 170.bmp
```

### 3. サーバー起動

**ターミナル1: バックエンド**
```bash
python3 -m uvicorn backend.app:app --reload --port 8000
```

**ターミナル2: フロントエンド**
```bash
cd frontend
npm run dev
```

### 4. ブラウザでアクセス

http://localhost:5173 を開き、「START」ボタンをクリックすると：
1. 画像処理が実行される（進捗バー表示）
2. 処理完了後、3D点群が表示される

## ディレクトリ構成

```
optical-device-ui/
├── frontend/               # React フロントエンド
│   ├── src/
│   │   ├── App.tsx        # メインコンポーネント
│   │   └── utils/         # ユーティリティ関数
│   └── public/data/       # 画像データ格納場所
├── backend/
│   └── app.py             # FastAPI サーバー
├── scripts/
│   └── preprocess_images.py  # 画像処理モジュール
├── CLAUDE.md              # Claude Code用ガイド
└── README.md
```

## 開発コマンド

```bash
# フロントエンド
cd frontend
npm run dev      # 開発サーバー起動
npm run build    # 本番ビルド
npm run lint     # ESLint実行

# バックエンド
python3 -m uvicorn backend.app:app --reload --port 8000

# 画像処理（CLI単体実行）
python3 scripts/preprocess_images.py
```
