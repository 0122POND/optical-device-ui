# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

光学デバイスから取得した3次元面形状をブラウザで可視化するWebアプリケーション。React + TypeScript のフロントエンドと、FastAPI の WebSocket バックエンドで構成。

## 開発コマンド

### フロントエンド（frontend/ディレクトリで実行）

```bash
npm install          # 依存関係インストール
npm run dev          # 開発サーバー起動 (http://localhost:5173)
npm run build        # 本番ビルド（TypeScriptチェック + Viteビルド）
npm run lint         # ESLint実行
```

### バックエンド（backend/ディレクトリで実行）

```bash
python app.py        # FastAPIサーバー起動
```

## アーキテクチャ

### フロントエンドのデータフロー

1. **表面データ生成**: `utils/surface.ts` - パラメトリック3D表面（コイン計測シミュレーション）
2. **ポイントストリーミング**: `utils/stream.ts` - 蛇行順序で点を漸進的にレンダリング
3. **点群処理**: `utils/pointCloud.ts` - BMPスライス画像から3D点群を構築
4. **可視化**: Plotly.js による3Dインタラクティブプロット

### データ構造

- **Surface**: `(number | null)[][]` - 2Dグリッド（null=データなし、number=高さ）
- **Point Cloud**: `{ x: number[], y: number[], z: number[], c: number[] }` - c は深度/強度による色

### WebSocketプロトコル

```
Client → Server: {"cmd": "start/start_stream/stop/ping", "params": {...}}
Server → Client: {"type": "status/result/error/pong", "zData": [[...]], "meta": {...}}
```

## コード規約

- **TypeScript**: strict モード有効（noUnusedLocals, noUnusedParameters）
- **コミットメッセージ**: 日本語、プレフィックス使用 `[add]`, `[fix]`, `[change]`
- **ブランチ**: `feature/*` でPRベースの開発
