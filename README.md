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

# AI推論機能を使用する場合（追加）
pip3 install torch segmentation-models-pytorch albumentations opencv-python-headless
```

### 2. 画像データの配置

処理対象の画像を以下に配置してください：

```
data/row_data/
├── 001.bmp
├── 002.bmp
├── ...
└── (任意の枚数)
```

### 3. サーバー起動

#### 簡単な起動方法（推奨）

**Windows:**
- `start_win.bat` をダブルクリック

**macOS / Linux:**
```bash
./start_mac.sh
```

#### 終了方法

- `Ctrl+C` を押す、または
- 終了スクリプトを実行:
  - Windows: `stop_win.bat` をダブルクリック
  - macOS / Linux: `./stop_mac.sh`

※ 起動スクリプトは、前回のプロセスが残っていた場合も自動でクリーンアップします。

#### 手動で起動する場合

**ターミナル1: バックエンド**
```bash
cd backend
python -m uvicorn app:app --host 0.0.0.0 --port 8000
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
├── data/                   # 画像データ格納場所
│   ├── row_data/          # 入力画像
│   └── result/            # 処理結果
├── frontend/               # React フロントエンド
│   ├── src/
│   │   ├── App.tsx        # メインコンポーネント
│   │   └── utils/         # ユーティリティ関数
│   └── public/
├── backend/
│   ├── app.py             # FastAPI サーバー（静的ファイル配信含む）
│   └── preprocessing_*.py # 画像処理モジュール（algorithm×GPU/CPU別）
├── docs/                   # ドキュメント
├── start_win.bat          # 起動スクリプト（Windows用）
├── start_mac.sh           # 起動スクリプト（macOS/Linux用）
├── stop_win.bat           # 終了スクリプト（Windows用）
├── stop_mac.sh            # 終了スクリプト（macOS/Linux用）
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
```

## ライセンス

このプロジェクトは [Apache License 2.0](LICENSE) の下で公開されています。
