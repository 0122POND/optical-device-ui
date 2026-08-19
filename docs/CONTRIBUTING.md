# 開発ガイド

このドキュメントでは、プロジェクトへの貢献方法と開発環境のセットアップについて説明します。

## 開発環境セットアップ

### 必要なツール

- Node.js 20以上
- Python 3.10以上
- Git
- （オプション）CUDA 対応 GPU + CuPy（GPU 前処理を使う場合）
- （オプション）PyTorch 対応 GPU（AI 推論を使う場合）

### 初回セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/0122POND/optical-device-ui.git
cd optical-device-ui

# ルートの依存関係（Husky / lint-staged）
npm install

# フロントエンドの依存関係
cd frontend
npm install
cd ..

# バックエンドの依存関係（requirements.txt 一括インストール推奨）
pip3 install -r backend/requirements.txt
```

`backend/requirements.txt` には次が含まれます：

- **コア**: numpy / scipy / opencv-python / fastapi / uvicorn / websockets / python-multipart / Pillow / h5py
- **AI推論**: torch / segmentation-models-pytorch / albumentations / timm / transformers

**GPU 利用時の追加インストール**（CUDA バージョンに合わせて）：

```bash
# CUDA 11.x
pip install cupy-cuda11x

# CUDA 12.x
pip install cupy-cuda12x
```

### 開発サーバー起動

#### 簡単起動（推奨）

| OS | コマンド |
|----|---------|
| macOS / Linux | `./start_mac.sh` |
| Windows | `start_win.bat` をダブルクリック |

スクリプトはバックエンド（uvicorn）とフロントエンド（Vite）を同時に起動し、ブラウザを自動で開きます。前回プロセスが残っている場合は 8000 / 5173 番ポートを解放してから起動します。

#### 終了

| OS | コマンド |
|----|---------|
| macOS / Linux | `./stop_mac.sh` または `Ctrl+C` |
| Windows | `stop_win.bat` |

#### 手動起動

```bash
# ターミナル1: バックエンド
cd backend
python3 -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload

# ターミナル2: フロントエンド
cd frontend
npm run dev
```

ブラウザ: <http://localhost:5173>

## ブランチ戦略

```
main
  │
  ├── feature/xxx    # 新機能開発
  ├── fix/xxx        # バグ修正
  └── refactor/xxx   # リファクタリング
```

- `main` ブランチへの直接プッシュは禁止
- 必ず Pull Request を作成してマージ

## コミット規約

### プレフィックス

| プレフィックス | 用途 |
|--------------|------|
| `[add]` | 新機能追加 |
| `[fix]` | バグ修正 |
| `[update]` | 既存機能の改善 |
| `[change]` | 仕様変更 |
| `[remove]` | 機能・コード削除 |
| `[refactor]` | リファクタリング |
| `[docs]` | ドキュメント更新 |

メッセージ本文は日本語で記述する。

### 例

```
[add] AI推論用の SegFormer-B2 モデルを追加
[fix] AI推論の入力画像ソートを辞書式から自然順に修正
[change] 未使用の3D表示スクリプト view_tgv4.py を削除
```

## コード品質

### 自動チェック（コミット時）

ルートの `package.json` で Husky + lint-staged が設定されています。コミット時に `frontend/src/**/*.{ts,tsx}` に対して以下が自動実行されます：

1. **Prettier** - コードフォーマット
2. **ESLint** - コード品質チェック

### 手動チェック

```bash
cd frontend

# フォーマットチェック
npm run format:check

# フォーマット適用
npm run format

# Lint チェック
npm run lint

# ビルド（TypeScript 型チェック含む）
npm run build
```

### TypeScript 設定

- strict モード有効
- `noUnusedLocals` / `noUnusedParameters` 有効

### Python コード（参考）

公式の lint 設定は導入していないが、フォーマットには `black`、型チェックには `mypy` の利用を推奨。

## Pull Request

### PR の作成手順

1. feature ブランチを作成
2. 変更をコミット
3. GitHub で PR を作成
4. CI が通ることを確認
5. レビュー後にマージ

### PR テンプレート

```markdown
## Summary
- 変更内容を箇条書きで記載

## Test plan
- [ ] テスト項目1
- [ ] テスト項目2
```

## CI / CD

GitHub Actions で以下が自動実行されます：

| チェック | 内容 |
|---------|------|
| Prettier | フォーマットチェック |
| ESLint | コード品質チェック |
| Build | TypeScript 型チェック + Vite ビルド |

PR がマージされる前に、すべてのチェックが通る必要があります。

## ディレクトリ構成（参考）

```
optical-device-ui/
├── frontend/          # React + Vite フロントエンド
├── backend/           # FastAPI バックエンド
│   ├── app.py
│   ├── ai_inference.py
│   ├── depth_inference.py / depth_calibration.py
│   ├── preprocessing_*.py
│   ├── models/
│   └── requirements.txt
├── tools/             # 補間 / 品質分析 / 評価用 CLI スクリプト
├── data/              # 入力画像・結果（gitignore）
├── docs/              # ドキュメント
├── start_mac.sh / start_win.bat
├── stop_mac.sh / stop_win.bat
└── CLAUDE.md          # Claude Code 用ガイド
```
