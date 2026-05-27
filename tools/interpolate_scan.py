"""
走査方向（列方向）の補間で、干渉縞間の欠損を埋めるスクリプト。
小さいギャップは線形補間、中程度のギャップのみスプライン補間を適用。
Usage: python tools/interpolate_scan.py 50円玉裏面.csv [keyence.csv]
"""
import csv
import sys
import numpy as np

MISSING = -9999.9

# ギャップサイズの閾値
MAX_LINEAR_GAP = 3    # 3行以下は線形補間
MAX_SPLINE_GAP = 8    # 4〜8行はスプライン補間（近傍の点を使う）
                       # 9行以上のギャップは埋めない


def load_csv(path: str) -> np.ndarray:
    with open(path, "r") as f:
        return np.array([[float(v) for v in row] for row in csv.reader(f)])


def find_gaps(valid_mask: np.ndarray):
    """欠損のギャップ区間（start, end）のリストを返す。有効データ範囲内のみ。"""
    valid_idx = np.where(valid_mask)[0]
    if len(valid_idx) < 2:
        return []
    first, last = valid_idx[0], valid_idx[-1]
    gaps = []
    in_gap = False
    gap_start = 0
    for i in range(first, last + 1):
        if not valid_mask[i]:
            if not in_gap:
                gap_start = i
                in_gap = True
        else:
            if in_gap:
                gaps.append((gap_start, i - 1))
                in_gap = False
    if in_gap:
        gaps.append((gap_start, last))
    return gaps


def interpolate_columns(data: np.ndarray) -> tuple[np.ndarray, int, int, int]:
    """各列について、ギャップサイズに応じた補間を行う。"""
    result = data.copy()
    rows, cols = data.shape
    linear_count = 0
    spline_count = 0
    skipped_count = 0

    for col in range(cols):
        column = data[:, col]
        valid_mask = column != MISSING
        valid_idx = np.where(valid_mask)[0]

        if len(valid_idx) < 2:
            continue

        gaps = find_gaps(valid_mask)

        for gap_start, gap_end in gaps:
            gap_size = gap_end - gap_start + 1

            if gap_size <= MAX_LINEAR_GAP:
                # 線形補間: 直前と直後の有効値で線形内挿
                before = gap_start - 1
                after = gap_end + 1
                if before >= 0 and after < rows and valid_mask[before] and valid_mask[after]:
                    v0 = column[before]
                    v1 = column[after]
                    for i in range(gap_start, gap_end + 1):
                        t = (i - before) / (after - before)
                        result[i, col] = v0 + t * (v1 - v0)
                    linear_count += gap_size

            elif gap_size <= MAX_SPLINE_GAP:
                # 近傍点を使った局所スプライン補間
                # ギャップの前後からそれぞれ最大5点ずつ取得
                before_pts = valid_idx[valid_idx < gap_start][-5:]
                after_pts = valid_idx[valid_idx > gap_end][:5]
                local_idx = np.concatenate([before_pts, after_pts])

                if len(local_idx) < 4:
                    # 点が足りなければ線形で代替
                    before = gap_start - 1
                    after = gap_end + 1
                    if before >= 0 and after < rows and valid_mask[before] and valid_mask[after]:
                        v0 = column[before]
                        v1 = column[after]
                        for i in range(gap_start, gap_end + 1):
                            t = (i - before) / (after - before)
                            result[i, col] = v0 + t * (v1 - v0)
                        linear_count += gap_size
                    continue

                local_vals = column[local_idx]

                try:
                    # 3次スプライン（局所的な点のみ使用）
                    from scipy.interpolate import CubicSpline
                    cs = CubicSpline(local_idx, local_vals, bc_type='natural')
                    gap_indices = np.arange(gap_start, gap_end + 1)
                    interpolated = cs(gap_indices)

                    # 値の範囲チェック: 近傍の有効値の範囲から大きく外れたら棄却
                    local_min = local_vals.min()
                    local_max = local_vals.max()
                    margin = (local_max - local_min) * 0.3
                    safe_min = local_min - margin
                    safe_max = local_max + margin

                    if np.all((interpolated >= safe_min) & (interpolated <= safe_max)):
                        result[gap_indices, col] = interpolated
                        spline_count += gap_size
                    else:
                        # スプラインが暴れたら線形にフォールバック
                        before = before_pts[-1] if len(before_pts) > 0 else None
                        after = after_pts[0] if len(after_pts) > 0 else None
                        if before is not None and after is not None:
                            v0 = column[before]
                            v1 = column[after]
                            for i in range(gap_start, gap_end + 1):
                                t = (i - before) / (after - before)
                                result[i, col] = v0 + t * (v1 - v0)
                            linear_count += gap_size
                        else:
                            skipped_count += gap_size
                except Exception:
                    skipped_count += gap_size
            else:
                skipped_count += gap_size

    return result, linear_count, spline_count, skipped_count


def stats(data: np.ndarray, label: str):
    valid = data[data != MISSING]
    total = data.size
    n_valid = len(valid)
    print(f"\n=== {label} ===")
    print(f"  shape: {data.shape[0]} x {data.shape[1]}")
    print(f"  valid: {n_valid} / {total} ({n_valid/total*100:.1f}%)")
    if len(valid) > 0:
        print(f"  range: {valid.min():.1f} ~ {valid.max():.1f}")
        print(f"  mean:  {valid.mean():.1f}")

    # 列方向の連続性
    all_valid_runs = []
    all_gap_runs = []
    for col in range(data.shape[1]):
        col_valid = data[:, col] != MISSING
        if not any(col_valid):
            continue
        current = col_valid[0]
        length = 1
        for i in range(1, len(col_valid)):
            if col_valid[i] == current:
                length += 1
            else:
                if current:
                    all_valid_runs.append(length)
                else:
                    all_gap_runs.append(length)
                current = col_valid[i]
                length = 1
        if current:
            all_valid_runs.append(length)
        else:
            all_gap_runs.append(length)

    if all_valid_runs:
        print(f"  valid segment: avg={np.mean(all_valid_runs):.1f}, median={np.median(all_valid_runs):.0f}")
    if all_gap_runs:
        print(f"  gap segment:   avg={np.mean(all_gap_runs):.1f}, median={np.median(all_gap_runs):.0f}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python interpolate_scan.py <input.csv> [keyence.csv]")
        sys.exit(1)

    input_path = sys.argv[1]
    keyence_path = sys.argv[2] if len(sys.argv) > 2 else None

    print("Loading input data...")
    data = load_csv(input_path)
    stats(data, "補間前（実験装置）")

    print("\nRunning interpolation along scan direction...")
    print(f"  Strategy: linear for gap<=3, local spline for gap<=8, skip for gap>8")
    result, n_linear, n_spline, n_skipped = interpolate_columns(data)
    print(f"  Linear: {n_linear} cells, Spline: {n_spline} cells, Skipped: {n_skipped} cells")
    stats(result, "補間後")

    # 補間結果を保存
    out_path = input_path.replace(".csv", "_interpolated.csv")
    with open(out_path, "w", newline="") as f:
        writer = csv.writer(f)
        for row in result:
            writer.writerow([f"{v:.1f}" for v in row])
    print(f"\nSaved to: {out_path}")

    # Keyenceデータとの比較
    if keyence_path:
        keyence = load_csv(keyence_path)
        stats(keyence, "Keyence（参考）")

        print("\n=== 有効率の比較 ===")
        for label, d in [("補間前", data), ("補間後", result)]:
            valid_pct = np.sum(d != MISSING) / d.size * 100
            print(f"  {label}: {valid_pct:.1f}%")
        keyence_valid_pct = np.sum(keyence != MISSING) / keyence.size * 100
        print(f"  Keyence: {keyence_valid_pct:.1f}%")


if __name__ == "__main__":
    main()
