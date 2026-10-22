"""高さマップCSVを tools/surface_viewer.html に埋め込み、ダブルクリックで開ける単体HTMLを作る。

高さは Uint16 に量子化（65535 = 欠損）して gzip → base64 で埋め込む。
three.js は CDN から読むので、表示時はネット接続が必要。

使い方:
    python tools/pack_surface_viewer.py WI5000/10円表_stitched.csv --pitch 37.4 -o out/10円裏_viewer.html
"""
import argparse
import base64
import gzip
import json
from pathlib import Path

import numpy as np

MISSING = -9999.9
TEMPLATE = Path(__file__).with_name("surface_viewer.html")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", help="高さマップCSV（-9999.9 = 欠損）")
    ap.add_argument("-o", "--output", help="出力HTML（既定: out/<CSV名>_viewer.html）")
    ap.add_argument("--pitch", type=float, default=10.0, help="x/y 共通ピッチ[µm/pix]（既定10）")
    ap.add_argument("--pitch-x", type=float, help="x ピッチ[µm/pix]（--pitch より優先）")
    ap.add_argument("--pitch-y", type=float, help="y ピッチ[µm/pix]（--pitch より優先）")
    ap.add_argument("--z-exaggeration", type=float, default=5.0, help="初期の z 強調倍率（既定5）")
    args = ap.parse_args()

    src = Path(args.csv)
    z = np.loadtxt(src, delimiter=",", dtype=np.float64)
    valid = np.isfinite(z) & (z > MISSING + 0.05)
    lo, hi = float(z[valid].min()), float(z[valid].max())
    q = np.full(z.shape, 65535, dtype="<u2")
    q[valid] = np.round((z[valid] - lo) / ((hi - lo) or 1.0) * 65534).astype("<u2")

    meta = {
        "name": src.name, "w": int(z.shape[1]), "h": int(z.shape[0]), "lo": lo, "hi": hi,
        "pitch_x": args.pitch_x or args.pitch, "pitch_y": args.pitch_y or args.pitch,
        "z_exaggeration": args.z_exaggeration,
    }
    pack = base64.b64encode(gzip.compress(q.tobytes(), 9)).decode("ascii")

    html = TEMPLATE.read_text(encoding="utf-8")
    html = html.replace('<script type="application/json" id="embed-meta">null</script>',
                        f'<script type="application/json" id="embed-meta">{json.dumps(meta, ensure_ascii=False)}</script>', 1)
    html = html.replace('<script type="text/plain" id="embed-pack"></script>',
                        f'<script type="text/plain" id="embed-pack">{pack}</script>', 1)

    out = Path(args.output) if args.output else Path("out") / f"{src.stem}_viewer.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"{out}  ({out.stat().st_size / 1e6:.1f} MB, {meta['w']}×{meta['h']}, 有効 {valid.mean() * 100:.1f}%)")


if __name__ == "__main__":
    main()
