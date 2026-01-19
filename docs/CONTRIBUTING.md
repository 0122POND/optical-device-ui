# 開発ガイド

このドキュメントでは、プロジェクトへの貢献方法について説明します。

## 開発環境セットアップ

### 必要なツール

- Node.js 20以上
- Python 3.10以上
- Git

### 初回セットアップ

```bash
# リポジトリをクローン
git clone https://github.com/0122POND/optical-device-ui.git
cd optical-device-ui

# フロントエンドの依存関係インストール
cd frontend
npm install

# ルートの依存関係インストール（Husky/lint-staged）
cd ..
npm install

# バックエンドの依存関係インストール
pip3 install fastapi uvicorn websockets numpy Pillow scipy
```

### 開発サーバー起動

```bash
# ターミナル1: バックエンド
python3 -m uvicorn backend.app:app --reload --port 8000

# ターミナル2: フロントエンド
cd frontend
npm run dev
```

## ブランチ戦略

```
main
  │
  ├── feature/xxx    # 新機能開発
  ├── fix/xxx        # バグ修正
  └── refactor/xxx   # リファクタリング
```

- `main`ブランチへの直接プッシュは禁止
- 必ずPull Requestを作成してマージ

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

### 例

```
[add] ダークモード切り替え機能を追加
[fix] 点群描画時のメモリリークを修正
[update] 進捗バーのアニメーションを改善
```

## コード品質

### 自動チェック（コミット時）

コミット時にHusky + lint-stagedが自動で実行されます：

1. **Prettier** - コードフォーマット
2. **ESLint** - コード品質チェック

### 手動チェック

```bash
cd frontend

# フォーマットチェック
npm run format:check

# フォーマット適用
npm run format

# Lintチェック
npm run lint

# ビルド（TypeScriptチェック含む）
npm run build
```

## Pull Request

### PRの作成手順

1. featureブランチを作成
2. 変更をコミット
3. GitHubでPRを作成
4. CIが通ることを確認
5. レビュー後にマージ

### PRテンプレート

```markdown
## Summary
- 変更内容を箇条書きで記載

## Test plan
- [ ] テスト項目1
- [ ] テスト項目2
```

## CI/CD

GitHub Actionsで以下が自動実行されます：

| チェック | 内容 |
|---------|------|
| Prettier | フォーマットチェック |
| ESLint | コード品質チェック |
| Build | TypeScript型チェック + Viteビルド |

PRがマージされる前に、すべてのチェックが通る必要があります。
