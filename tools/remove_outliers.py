"""
MAD (Median Absolute Deviation) ベースの外れ値検出・除去スクリプト。

中央値を基準に、MAD×1.4826 をσ相当として閾値を決め、
|value - median| > nσ の点をMISSINGに置換する。
平均・標準偏差と違い、外れ値自身に引きずられない頑健な検出。

Usage:
    # 外れ値をMISSINGに置換（補間なし）
    python tools/remove_outliers.py input.csv output.csv

    # 閾値を4σに変更
    python tools/remove_outliers.py input.csv output.csv --sigma 4

    # 外れ値除去 + 再補間まで一気通貫
    python tools/remove_outliers.py input.csv output.csv --interpolate
"""
import argparse
import csv
import sys
from pathlib import Path

import numpy as np

MISSING = -9999.9
MAD_TO_SIGMA = 1.4826  # 正規分布でMAD×1.4826 ≈ σ


def load_csv(path: str) -> np.ndarray:
    with open(path) as f:
        return np.array([[float(v) for v in r] for r in csv.reader(f)])


def save_csv(path: str, data: np.ndarray) -> None:
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        for row in data:
            w.writerow([f"{v:.1f}" for v in row])


def detect_outliers(data: np.ndarray, sigma: float = 3.0) -> tuple[np.ndarray, dict]:
    """MADベースで外れ値マスクを返す。MISSING値は除外して統計を取る。"""
    valid_mask = data != MISSING
    valid_vals = data[valid_mask]

    med = float(np.median(valid_vals))
    mad = float(np.median(np.abs(valid_vals - med)))
    thresh = sigma * MAD_TO_SIGMA * mad

    outlier_mask = valid_mask & (np.abs(data - med) > thresh)

    info = {
        "median": med,
        "mad": mad,
        "sigma_est": MAD_TO_SIGMA * mad,
        "threshold": thresh,
        "n_outliers": int(outlier_mask.sum()),
        "n_valid": int(valid_mask.sum()),
    }
    return outlier_mask, info


def remove_outliers(data: np.ndarray, sigma: float = 3.0) -> tuple[np.ndarray, dict]:
    """外れ値をMISSINGに置換した配列を返す。"""
    outlier_mask, info = detect_outliers(data, sigma)
    result = data.copy()
    result[outlier_mask] = MISSING
    return result, info


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("input", help="入力CSV")
    parser.add_argument("output", help="出力CSV")
    parser.add_argument(
        "--sigma", type=float, default=3.0,
        help="外れ値判定の閾値（σ換算, default: 3.0）",
    )
    parser.add_argument(
        "--interpolate", action="store_true",
        help="外れ値除去後に interpolate_scan.py のロジックで再補間",
    )
    args = parser.parse_args()

    data = load_csv(args.input)
    print(f"入力: {args.input}  shape={data.shape}")

    cleaned, info = remove_outliers(data, sigma=args.sigma)
    print(f"中央値: {info['median']:.2f}")
    print(f"MAD: {info['mad']:.2f}  (σ推定: {info['sigma_est']:.2f})")
    print(f"閾値: ±{info['threshold']:.2f}  ({args.sigma}σ相当)")
    print(f"外れ値: {info['n_outliers']} / {info['n_valid']} 点")

    if args.interpolate:
        sys.path.insert(0, str(Path(__file__).parent))
        from interpolate_scan import interpolate_columns

        cleaned, n_lin, n_spl, n_skip = interpolate_columns(cleaned)
        print(f"再補間: Linear={n_lin}, Spline={n_spl}, Skipped={n_skip}")

    save_csv(args.output, cleaned)
    valid_pct = (cleaned != MISSING).mean() * 100
    print(f"出力: {args.output}  有効率={valid_pct:.2f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
