# Optical Device UI（Tori-Ton UI）

光学デバイス（干渉計測）で取得した画像から3次元の面形状を求め、ブラウザで表示・計測するアプリケーションです。

![画面](docs/images/ui_overview.jpg)

## 機能

- **計測**: 掃引で撮った干渉画像から高さマップと点群を作る（古典的な前処理 CPU/GPU、AI推論）。進捗表示と中止
- **読込・書き出し**: 高さマップCSV（Keyence・WI5000・自社）、点群形式CSV（複数層）、マスク画像フォルダ。µm で書き出し、ピッチと単位をファイル名に記録
- **表示**: 3D / 2D、Surface / 点群、Plotly / three.js（高密度点群・CAD風メッシュ）、視点のプリセット、自動回転、画像保存
- **後処理**: 外れ値の除去（近傍 / 全体）、走査方向の補間（補った画素は印で区別）
- **計測ツール**: 2点間距離、2D寸法、断面（線 / 帯の幅で中央値とばらつき）
- **統計**: 有効率（全体・中央50%×50%・中央面積50%）、高さの分布、平面除去後の Sq/Sa、処理条件
- **測定履歴**: ブラウザに最新20件を保存（再読み込みしても残る）

画面の詳しい仕様と、結果を読むときの注意は **[UI仕様書](docs/UI仕様書.md)** を見てください。

## 技術スタック

- **フロントエンド**: React 19 + TypeScript、Vite、Plotly.js、three.js
- **バックエンド**: Python + FastAPI（WebSocket）、NumPy / SciPy / OpenCV、PyTorch + segmentation-models-pytorch（AI推論）、CuPy（GPU、任意）

## はじめかた

```bash
# 依存関係（初回のみ）
npm install                                  # ルート（コミット時の整形フック）
cd frontend && npm install && cd ..
pip3 install -r backend/requirements.txt     # GPU を使うなら CuPy も（requirements.txt の説明参照）
```

- 計測する画像は `data/row_data/` に置きます（`img_NNN.png` など。番号は数値順に並べる）
- AI計測には学習済みモデル `backend/models/best_model_resnet50.pth` が必要です（リポジトリには含まれません）

```bash
./start_mac.sh     # macOS / Linux（Windows は start_win.bat をダブルクリック）
./stop_mac.sh      # 停止（Windows は stop_win.bat）
```

http://localhost:5173 を開きます。手動で起動する場合は `backend/` で `python3 -m uvicorn app:app --host 0.0.0.0 --port 8000`、`frontend/` で `npm run dev`。

## 資料

| 資料 | 内容 |
|---|---|
| [UI仕様書](docs/UI仕様書.md) | 画面の構成と各機能、データの種類と単位、読み方の注意、既知の制約（新しく入った人はここから） |
| [開発手順](docs/開発手順.md) | 開発の進め方、どこを直すか、確認のしかた |
| [開発ガイド](docs/CONTRIBUTING.md) | ブランチ・コミット規約 |
| [アーキテクチャ](docs/ARCHITECTURE.md) | 構成図とファイルの役割 |
| [API仕様書](docs/API.md) | バックエンドの WebSocket / HTTP |
| [デプロイ手順](docs/デプロイ手順.md) | 対象 PC への配備・起動停止 |
| [CLAUDE.md](CLAUDE.md) | 解析ツール（`tools/`）の使い方と検証済みの知見 |

## ディレクトリ構成

```
optical-device-ui/
├── frontend/            # React + Vite（src/App.tsx, components/, hooks/, utils/）
├── backend/             # FastAPI（app.py）、前処理（preprocessing_*.py）、AI推論（ai_inference.py）
├── tools/               # 補間・評価・スティッチングなどの解析ツール（CLAUDE.md 参照）
├── data/                # 入力画像と結果（row_data/, result/, mask_result/ など。大半は git 管理外）
├── docs/                # 資料
├── start_mac.sh / stop_mac.sh / start_win.bat / stop_win.bat
└── CLAUDE.md
```

## 開発コマンド（frontend/ で）

```bash
npm run dev      # 開発サーバー
npm test         # ユニットテスト（vitest）
npm run lint     # ESLint
npm run build    # 型チェック + 本番ビルド
```

## ライセンス

このプロジェクトは [Apache License 2.0](LICENSE) の下で公開されています。
