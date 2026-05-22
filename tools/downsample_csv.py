"""
CSV（高さマップ／検出結果グリッド）を行・列方向に間引いてダウンサンプリングする。

2200×1008 のような大規模グリッドは Plotly の scatter3d / surface で処理落ちする。
行・列を一定ステップで間引き、表示可能なサイズに縮小する。値はそのまま保持
（-9999.9 等の欠損もそのまま）。

使い方:
  python tools/downsample_csv.py 入力.csv 出力.csv --row-step 5 --col-step 3
"""
import argparse


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--row-step", type=int, default=5, help="行(スライス)の間引き間隔")
    ap.add_argument("--col-step", type=int, default=3, help="列の間引き間隔")
    args = ap.parse_args()

    lines = open(args.input, encoding="utf-8").read().splitlines()
    src_rows = len(lines)
    src_cols = len(lines[0].rstrip(",").split(",")) if lines else 0

    sampled = lines[:: args.row_step]
    out = []
    for line in sampled:
        cells = line.rstrip(",").split(",")
        out.append(",".join(cells[:: args.col_step]))

    with open(args.output, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

    dst_rows = len(out)
    dst_cols = len(out[0].split(",")) if out else 0
    print(f"行 {src_rows} → {dst_rows}  (1/{args.row_step})")
    print(f"列 {src_cols} → {dst_cols}  (1/{args.col_step})")
    print(f"グリッド {src_rows * src_cols:,} → {dst_rows * dst_cols:,} セル")
    print(f"出力: {args.output}")


if __name__ == "__main__":
    main()
