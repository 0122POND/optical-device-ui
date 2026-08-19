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

## 補間ツール

### `tools/interpolate_masks.py`

干渉縞マスク画像群を行ごとのX座標重心 → スプライン補間 → スライス間ガウシアン平滑化で処理し、欠損を埋めたマスク画像を出力する。1円玉裏側データで良好な結果が得られている（マスク単体スプライン方式、Keyenceガイドなし）。

```bash
# 基本（補間のみ）
python tools/interpolate_masks.py data/mask_result/ data/output/

# 10mm×10mm範囲 + スライス間平滑化 + GIF
python tools/interpolate_masks.py data/mask_result/ data/output/ \
    --spatial-mm 10 --sweep-mm 10 --sweep-interval-um 100 --smooth-sigma 2 --gif
```

### `tools/interpolate_scan.py`

Keyence互換CSV（-9999.9 = 欠損）の列方向（走査方向）欠損を埋める。gap≤3は線形補間、gap≤8は局所スプライン、gap>8はスキップ。

```bash
python tools/interpolate_scan.py input.csv [keyence.csv]  # 第2引数は参考比較用
```

### `tools/remove_outliers.py`

MAD（中央絶対偏差）ベースの外れ値検出・除去。中央値基準で `MAD × 1.4826` をσ換算し、`nσ` 超えをMISSING(-9999.9)に置換。平均・標準偏差と違い外れ値自身に引きずられないため、極端値を頑健に拾える。

```bash
# 外れ値をMISSINGに置換
python tools/remove_outliers.py input.csv output.csv --sigma 3

# 外れ値除去 + interpolate_scan.py で再補間まで一気通貫
python tools/remove_outliers.py input.csv output.csv --interpolate
```

関数import可: `from tools.remove_outliers import remove_outliers, detect_outliers`

### `tools/stitch_tiles.py`

WI5000等で分割計測した高さマップCSV群（-9999.9=欠損）を1枚に合成する。全ペアをマスク付き位相相関で位置合わせ→重なりの高さ差MADでペア選別→最小二乗でグローバル配置→z補正（既定はピストンのみ、`--tilt`で平面も）→距離変換の羽根合成。WI5000の10円データ（3×3分割・タイル281×304）で継ぎ目残差 中央値±3µm・MAD 1〜3µm を確認済み。タイル間で基準面が共通なら`--tilt`は自由度過多でむしろ悪化する。

```bash
python tools/stitch_tiles.py WI5000/1円表/ -o 1円表_stitched.csv --preview
```

注: WI5000/ のフォルダ名は中身と食い違っている（「1円表」=10円の表、「10円表」「１０円裏」=10円の裏で両者は同一データ）。

### `tools/compare_to_reference.py`

自社デバイスの部分計測CSVを、全体の正解データ（WI5000スティッチ結果やKeyence）に位置合わせして精度を定量評価する。位置合わせはハイパス起伏画像のFFTマスク付き正規化相互相関（Padfield法）で、縞状欠損に頑健。zは重なり領域でピストン＋平面を頑健フィット後、指標を算出（z倍率は診断表示のみで補正しない）。

評価モードは2種類。`--mode fixed`（**主評価**）はx/y倍率を1.0固定（ピッチ指定を信頼）・z倍率も`--z-scale`固定で、探索は回転・平行移動・左右反転・z符号のみ。`--mode free`（既定、従来動作＝**校正診断**）は倍率を縦横独立に探索し、結果が実効ピッチの診断になる。指標（RMSE/MAE/MAD/|誤差|パーセンタイル/ワッサースタイン距離[µm]、W距離は補助指標）は同一の位置合わせから「全体／中央50%参照基準（硬貨中心の円盤、手法間で同一物理領域＝**比較用**）／中央50%デバイス基準（CSV範囲依存＝参考）／共通有効領域（`--common-mask`）」で算出。共通有効領域では A.共通有効領域率（対 参照有効画素、両手法で同値）と B.自手法・相手手法の有効点に占める共通点の割合を区別して出力。`--pose-json <他実行のmetrics.json>` で姿勢探索をスキップし**共通変換評価**（同一変換を両手法に適用、同一計測グリッド前提）ができる。出力はレポートPNG、`_metrics.json`、`_valid_mask.npy`、`_dz.npy`（ペア画素解析用誤差マップ）。誤差同士は系統誤差を共有し相関するため、**RMSE二乗差から「追加誤差成分」を求める解釈は禁止**（独立性仮定が成り立たない）。手法比較はペア画素解析（同一画素で|誤差|の勝敗・差分分布・ブートストラップCI）で行う。

```bash
# 主評価（倍率固定）。手法比較は _valid_mask.npy を相互に渡して共通有効領域で行う
python tools/compare_to_reference.py <デバイス.csv> <正解.csv> --mode fixed \
    --dev-pitch-y 10 --dev-pitch-x 10 --coin-mm 23.5 -o out/eval_<名前>
# 校正診断（装置構成が変わったとき1回、倍率探索）
python tools/compare_to_reference.py ... --mode free
```

運用の要点（10円裏で検証済み、fixed全体RMSE 13.3µm/NCC 0.77）:
- 自社CSV（`10円玉_表_20260620.csv` 形式）は**縦横10µm等方グリッド・z符号反転**だった。`--dev-pitch-x 10` を指定（過去の「x倍率0.49」は誤ピッチ20µm仮定を自由探索が補償していたもの）
- NCC<0.3は位置合わせ失敗（不正解ペアのノイズフロア≈0.29）。0.5超で成功。fixedモードでNCCが低い場合はピッチ指定の誤りも疑う（誤ピッチx=20µmでNCC 0.77→0.37に劣化して検出可能）
- **手法間比較は共通有効領域の行で行う**。全体RMSEはカバー範囲が違うため直接比較不可（欠損が多い手法が有利に見える）
- **最良スコアが探索境界（角度・倍率の端）に張り付いたら範囲を広げて再実行**。重ね合わせパネルで模様の一致を必ず目視確認
- 面ラベル（表/裏）はファイル名を信用せず模様で確認

### `tools/fill_from_reference.py`

正解データ（WI5000スティッチ等）をガイドに装置CSVの欠損を充填する。`compare_to_reference.py` と同じ位置合わせ（FFTマスク付きNCC）→座標画像ワープで装置元画素→正解元画素のアフィンを同定→正解を装置グリッドに逆サンプリング→z直線フィット（符号・ゲイン・オフセット吸収）＋残差の低周波補正場（σ既定0.5mm）で境界段差なく充填。実測の影響が届かない大穴は既定で見送り（`--fill-far`で全域）。出力は充填CSV・充填マスクCSV・レポートPNG・姿勢JSON（`--load-pose`で探索スキップ）。

```bash
python tools/fill_from_reference.py 10円玉_表_20260620_interpolated_safe_cropped.csv \
    WI5000/10円表_stitched.csv --dev-pitch-y 10 --dev-pitch-x 10 --coin-mm 23.5
```

10円ストリップ（有効64.5%）で検証済み: NCC 0.775、有効率64.5→99.8%、境界段差 中央値5.6µm。**充填画素は正解データ由来なので精度評価には充填前CSVを使うこと（循環評価になる）**。参照面の取り違え（NCC≈0.3・z倍率が異常に小さい）に注意 — 装置「10円玉_表_20260620」系の模様は10円の裏（「10」＋月桂樹）で、正解は `WI5000/10円表_stitched.csv`（フォルダ名と中身の食い違いに注意）。

### `tools/overlay_masks.py`

干渉縞画像に抽出マスク（縞線）を任意色で重ねたオーバーレイ画像を生成する。マスクが縞のピークを正しく追えているかの目視確認に使う。出力は `img_NNN_overlay.png`。

```bash
# バッチモード: ルート直下の各サブフォルダ(Ra0.05, Ra0.1...)を一括処理し
# 各フォルダ内に overlay/ を作成（既定色オレンジ）
python tools/overlay_masks.py 粗さ標準機/

# 単一ペアモード: 干渉フォルダとマスクフォルダを直接指定
python tools/overlay_masks.py --single 干渉/ mask_result/ -o overlay/

# 色(色名 or #RRGGBB)・線の太さ(膨張回数)を変更
python tools/overlay_masks.py 粗さ標準機/ --color "#00ffff" --thickness 2
```

干渉フォルダ名(`--fringe-name`)・マスクフォルダのglob(`--mask-glob`)も変更可。マスク対応は `img_NNN` → `img_NNN_mask.png`。サイズ不一致時はマスクを最近傍リサイズして合わせる。クリーニング済みマスクを使うには `--mask-glob "mask_result_*_cleaned"` を指定する。

### `tools/clean_masks.py`

干渉縞マスクから本線以外のノイズ（分離した小成分）を除去する。干渉縞は画像をほぼ縦に貫く1本の連続線なので、連結成分のうち**縦(y)スパンが最大の成分を本線とみなし、他を削除**する。粗さ標準機データでは本線スパン700px超に対しノイズは数十pxで明確に分離できる（要 `scipy`）。原本は保持し `mask_result_*_cleaned/` に出力。

```bash
# バッチモード: 各Raの mask_result_*/ をクリーニングし mask_result_*_cleaned/ に出力
python tools/clean_masks.py 粗さ標準機/

# 単一モード
python tools/clean_masks.py --single mask_result/ -o mask_result_cleaned/

# 本線が縦に分断される場合の保険: 縦スパン>=200px の成分を全て残す
python tools/clean_masks.py 粗さ標準機/ --min-span 200
```

クリーニング後にオーバーレイを作り直す典型手順:

```bash
python tools/clean_masks.py 粗さ標準機/
python tools/overlay_masks.py 粗さ標準機/ --mask-glob "mask_result_*_cleaned"
```

### `tools/masks_to_csv.py`

干渉縞マスク群を Keyence互換CSV（-9999.9=欠損）に変換する。各マスク(スライス)の行(y)ごとにマスク画素のx重心を取り、**1スライス=CSV1行 / 画像のy=CSV1列** で出力。粗さ標準機の元CSVと同一の生成規則で、原本マスクから再計算すると元CSVを**誤差0で再現**できる（検証済み）。クリーン後マスクに適用すればノイズ除去版CSVが得られる。

```bash
# ノイズ除去版CSV: 各Raの mask_result_*_cleaned/ から RaX.X_cleaned.csv を生成
python tools/masks_to_csv.py 粗さ標準機/ --mask-glob "mask_result_*_cleaned" --suffix _cleaned

# 単一モード
python tools/masks_to_csv.py --single mask_result_cleaned/ -o out.csv
```

注: ノイズは本線と同じ行に写ると重心を引っ張るため、除去版CSVは欠損化だけでなく多数セルの重心補正（粗さ標準機では本線位置へ平均約100px補正）を含む。

### `tools/add_synthetic_dots.py`

AI再学習用に、干渉縞画像へ合成白点ノイズ（埃状）を追加する。入力画像にだけ白点を合成し、正解にはクリーニング済みマスクをそのまま使うことで「白点はノイズであり検出対象ではない」を学習させる。実物の埃（飽和コア＋回折リング、フィルムサンプル①で23/285フレームが誤検出）を模し、ガウシアンコア＋確率50%で同心円リングを付ける。個数は全画像で固定（既定3個）、位置・輝度(60-255)・コアσ(1.5-4)・リング周期(4-7px)は画像ごとにランダム。シード×画像番号で決定的なので再実行しても同一結果。白点座標は `_dots_log.txt` に記録。

```bash
python tools/add_synthetic_dots.py フィルムサンプル①/row_data/ \
    -o フィルムサンプル①/row_data_synthnoise/
# 学習ペア: row_data_synthnoise/ (入力) × マスクデータ_cleaned/ (正解)
```

### `tools/analyze_detection_limit.py`

干渉縞マスク（推論結果）の検出限界を、縞のコントラスト(階調差)と背景光量で定量化する。各行で「縞ピーク−背景の階調差」「背景の絶対輝度」「推論が検出できたか」を突き合わせ、検出率の依存性を出す。中心線は検出x重心から内挿/端外挿で全行に補う。`out/detection_limit_<名前>.png` にヒートマップ(背景光量×コントラスト→検出率)を出力（要 matplotlib）。

```bash
python tools/analyze_detection_limit.py 粗さ標準機/Ra0.8
python tools/analyze_detection_limit.py 粗さ標準機/Ra0.05 粗さ標準機/Ra0.1 ...  # 複数可
```

粗さ標準機での知見: 検出限界は**コントラストより背景光量が支配的**。背景≧40階調で検出率ほぼ100%、背景<30階調で≈0%、50%遷移は背景≈33-35階調（上端の低光量域で取りこぼし）。

### `tools/plot_contrast_vs_y.py`

各Raで「行の高さy(横軸) × 縞の階調差(縦軸, 50枚平均)」のカーブを描き、推論の検出率が50%となる境界行の階調差を**AI検出閾値の水平線**で示す。検出率<50%の行（未検出域, 主に上端・下端の低光量部）を淡赤で塗る。「未検出域」は縞があるのに取り損ねたのか、縞がない/光量不足で原理的に取れないのかを区別せず、検出率<50%という事実のみを表す（命名上「取りこぼし」と断定しない）。日本語ラベル(macOS Hiragino使用)。`analyze_detection_limit.py` の関数を再利用。

```bash
python tools/plot_contrast_vs_y.py 粗さ標準機/
# -> out/contrast_vs_y_all.png（2×3グリッド）と out/contrast_vs_y_<Ra>.png
```

粗さ標準機では閾値≈3〜5階調。注: 明るい中央部では階調差が閾値を下回っても検出される（光量が高いため）＝閾値線は端部境界での値で、検出が純粋に階調差だけで決まるわけではない点に留意。

## コード規約

- **TypeScript**: strict モード有効（noUnusedLocals, noUnusedParameters）
- **コミットメッセージ**: 日本語、プレフィックス使用 `[add]`, `[fix]`, `[change]`
- **ブランチ**: `feature/*` でPRベースの開発
