"""
辞書式順で並んだ行を持つCSVを、参照画像フォルダのファイル名で自然順に並べ替える。

旧 ai_inference.py は画像を辞書式ソート（img_1, img_10, img_100, img_2 ...）で
処理していたため、出力CSVの行順がスライス順と一致しない。さらに row_data は
img_001〜img_999（3桁）と img_1000〜（4桁）が混在しており辞書式 ≠ 自然順。
元画像フォルダのファイル名から「辞書式→自然順」の対応を再構築し、
CSVの各行を正しいスライス順に並べ替える。

使い方:
  python tools/natural_sort_csv.py 入力.csv 出力.csv --images data/row_data
"""
import argparse
import os
import re


def natural_key(name: str):
    """ファイル名内の数字を数値として取り出すソートキー。"""
    m = re.search(r"img_(\d+)", name) or re.search(r"(\d+)", name)
    return int(m.group(1)) if m else float("inf")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="辞書式順で並んだ入力CSV")
    ap.add_argument("output", help="自然順に並べ替えた出力CSV")
    ap.add_argument("--images", required=True, help="推論対象の元画像フォルダ")
    ap.add_argument("--ext", default=".png,.bmp,.jpg,.jpeg",
                    help="対象画像拡張子（カンマ区切り）")
    args = ap.parse_args()

    exts = tuple(e if e.startswith(".") else "." + e
                 for e in args.ext.lower().split(","))
    files = [f for f in os.listdir(args.images) if f.lower().endswith(exts)]

    lex_order = sorted(files)                    # AI推論が処理した順（辞書式）
    nat_order = sorted(files, key=natural_key)   # 本来のスライス順

    lines = open(args.input, encoding="utf-8").read().splitlines()

    if len(lines) != len(files):
        raise SystemExit(
            f"中断: CSV行数({len(lines)}) と 画像数({len(files)}) が不一致。"
        )

    # 辞書式順での各ファイルの行index（= 入力CSVの行番号）
    lex_index = {name: i for i, name in enumerate(lex_order)}

    # 自然順に行を並べ替え
    reordered = [lines[lex_index[name]] for name in nat_order]

    with open(args.output, "w", encoding="utf-8") as f:
        f.write("\n".join(reordered) + "\n")

    moved = sum(1 for j, name in enumerate(nat_order) if lex_index[name] != j)
    print(f"入力 {len(lines)}行 → 自然順に並べ替え → {args.output}")
    print(f"位置が変わった行: {moved} / {len(lines)}")
    print("並べ替え例（位置が変わった先頭5件）:")
    shown = 0
    for j, name in enumerate(nat_order):
        src = lex_index[name]
        if src != j:
            print(f"  出力{j:5d}行目 ← 入力{src:5d}行目 : {name}")
            shown += 1
            if shown >= 5:
                break


if __name__ == "__main__":
    main()
