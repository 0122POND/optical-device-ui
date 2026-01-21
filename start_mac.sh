#!/bin/bash

echo "========================================"
echo "  3D Surface Measurement UI"
echo "========================================"
echo ""
echo "  起動中... しばらくお待ちください"
echo ""

# スクリプトのディレクトリに移動
cd "$(dirname "$0")"

# 終了時にバックエンドも終了させる
cleanup() {
    echo ""
    echo "終了処理中..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
    fi
    echo "終了しました。"
    exit 0
}

trap cleanup SIGINT SIGTERM

# バックエンドを起動（バックグラウンド）
echo "[1/2] バックエンドを起動しています..."
cd backend
python3 -m uvicorn app:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# 少し待機
sleep 2

# フロントエンドを起動
echo "[2/2] フロントエンドを起動しています..."
echo ""

# ブラウザを開く（バックグラウンドで少し待ってから）
(sleep 3 && open http://localhost:5173 2>/dev/null || xdg-open http://localhost:5173 2>/dev/null || start http://localhost:5173 2>/dev/null) &

echo "----------------------------------------"
echo "  ブラウザが自動で開きます"
echo "----------------------------------------"
echo ""
echo "  終了するには Ctrl+C を押してください"
echo ""

cd frontend
npm run dev

# フロントエンドが終了したらクリーンアップ
cleanup
