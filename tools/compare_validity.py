"""
50円玉裏面: 本装置 vs Keyence の有効率比較
- 全体
- 中央50%領域（行・列それぞれ中央25%〜75%）
- 最大のデータ歯抜け長（列方向の連続欠損区間の最大値）
"""
import csv
import sys
import numpy as np

MISSING = -9999.9


def load_csv(path: str) -> np.ndarray:
    rows = []
    with open(path, "r") as f:
        for row in csv.reader(f):
            vals = [float(v) for v in row if v != ""]
            if vals:
                rows.append(vals)
    n = max(len(r) for r in rows)
    arr = np.full((len(rows), n), MISSING)
    for i, r in enumerate(rows):
        arr[i, : len(r)] = r
    return arr


def valid_rate(data: np.ndarray) -> float:
    mask = data != MISSING
    return mask.sum() / mask.size * 100


def center_valid_rate(data: np.ndarray) -> float:
    h, w = data.shape
    r0, r1 = h // 4, h - h // 4
    c0, c1 = w // 4, w - w // 4
    sub = data[r0:r1, c0:c1]
    return valid_rate(sub), sub.shape


def max_column_gap(data: np.ndarray) -> tuple[int, float]:
    """列方向（走査方向）の、全有効データ範囲内での連続欠損最大長。
    全列を通した最大値と、列ごとの平均最大を返す。"""
    mask = data != MISSING
    rows, cols = data.shape
    global_max = 0
    per_col_max = []
    for c in range(cols):
        col = mask[:, c]
        idx = np.where(col)[0]
        if len(idx) < 2:
            continue
        first, last = idx[0], idx[-1]
        cur = 0
        col_max = 0
        for i in range(first, last + 1):
            if not col[i]:
                cur += 1
                col_max = max(col_max, cur)
            else:
                cur = 0
        per_col_max.append(col_max)
        global_max = max(global_max, col_max)
    return global_max, float(np.mean(per_col_max)) if per_col_max else 0.0


def analyze(name: str, path: str):
    data = load_csv(path)
    h, w = data.shape
    overall = valid_rate(data)
    center, csize = center_valid_rate(data)
    gmax, gavg = max_column_gap(data)
    print(f"\n=== {name} ===")
    print(f"path: {path}")
    print(f"サイズ: {h} x {w}")
    print(f"全体の有効率       : {overall:6.2f}%")
    print(f"中央50%領域の有効率 : {center:6.2f}%  (領域: {csize[0]} x {csize[1]})")
    print(f"列方向 最大欠損長  : {gmax} 行")
    print(f"列方向 平均最大欠損: {gavg:.2f} 行")
    return overall, center, gmax


if __name__ == "__main__":
    base = "/Users/mkuronuma/Documents/optical-device-ui"
    targets = [
        ("本装置 (補間前)", f"{base}/50円玉裏面.csv"),
        ("本装置 (補間後)", f"{base}/50円玉裏面_interpolated.csv"),
        ("Keyence", f"{base}/data/surface_keyence/260128_155543_50円玉_裏側_上.csv"),
    ]
    results = [(n, *analyze(n, p)) for n, p in targets]
    print("\n\n=== まとめ ===")
    print(f"{'対象':<18}{'全体':>10}{'中央50%':>12}{'最大歯抜け':>14}")
    for n, ov, ce, gm in results:
        print(f"{n:<18}{ov:>9.2f}%{ce:>11.2f}%{gm:>12}行")
