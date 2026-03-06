"""result_TGV4 の _final.bmp を重ね合わせて3D表示するスクリプト"""

import os
import re
import cv2
import numpy as np
import plotly.graph_objects as go

# --- 設定（フロントエンドの既存設定に準拠） ---
DATA_DIR = os.path.join(os.path.dirname(__file__), "result_TGV4")
UM_PER_PIXEL_X = 1.8       # 干渉画像の横方向（深さ方向）[µm/px]
UM_PER_PIXEL_Y = 20.0      # 干渉画像の縦方向 [µm/px]
Z_UM_PER_SLICE = 100.0     # 掃引間隔 [µm/スライス]
THRESHOLD = 128             # 輝度しきい値
# --- 画像読み込み ---
files = sorted(
    [f for f in os.listdir(DATA_DIR) if f.endswith("_final.bmp")],
    key=lambda f: int(re.search(r"(\d+)", f).group(1)),
)
print(f"画像枚数: {len(files)}")

D = len(files)

xs, ys, zs, cs = [], [], [], []

for zi, fname in enumerate(files):
    img = cv2.imread(os.path.join(DATA_DIR, fname), cv2.IMREAD_GRAYSCALE)
    if img is None:
        continue
    h, w = img.shape

    # 各Y行について輝度加重重心で1点に集約（フロントエンドと同じ方式）
    zz = D - 1 - zi  # Z反転
    for yy in range(h):
        row = img[yy, :].astype(float)
        mask = row > THRESHOLD
        if not np.any(mask):
            continue
        weights = row[mask]
        x_indices = np.where(mask)[0].astype(float)
        centroid_x = np.average(x_indices, weights=weights)
        xs.append(centroid_x)
        ys.append(float(yy))
        zs.append(float(zz))
        cs.append(centroid_x)

xs = np.array(xs)
ys = np.array(ys)
zs = np.array(zs)
cs = np.array(cs)

print(f"総点数: {len(xs)}")

# --- 物理単位（µm）に変換 ---
x_um = xs * UM_PER_PIXEL_X
y_um = ys * UM_PER_PIXEL_Y
z_um = zs * Z_UM_PER_SLICE
c_um = cs * UM_PER_PIXEL_X  # カラー用もµm

# --- CSV出力 ---
csv_path = os.path.join(os.path.dirname(__file__), "result_TGV4_points.csv")
np.savetxt(
    csv_path,
    np.column_stack([x_um, y_um, z_um, c_um]),
    delimiter=",",
    header="X_um,Y_um,Z_um,Color_um",
    comments="",
    fmt="%.3f",
)
print(f"CSV出力: {csv_path} ({len(x_um)} 点)")

# --- アスペクト比（フロントエンドと同じロジック） ---
x_range = x_um.max() - x_um.min() or 1
y_range = y_um.max() - y_um.min() or 1
z_range = z_um.max() - z_um.min() or 1
xy_max = max(x_range, y_range)

# --- 3D散布図 ---
fig = go.Figure(
    data=[
        go.Scatter3d(
            x=x_um,
            y=y_um,
            z=z_um,
            mode="markers",
            marker=dict(
                size=1,
                opacity=0.08,
                color=c_um,
                colorscale=[
                    [0, "#0000ff"],
                    [0.25, "#00bfff"],
                    [0.5, "#00ff00"],
                    [0.75, "#ffbf00"],
                    [1, "#ff0000"],
                ],
                showscale=True,
                colorbar=dict(
                    x=-0.05,
                    thickness=18,
                    len=0.9,
                    ypad=10,
                    tickfont=dict(color="#ffffff"),
                ),
            ),
        )
    ],
    layout=go.Layout(
        paper_bgcolor="#000000",
        margin=dict(l=0, r=0, t=30, b=0),
        scene=dict(
            bgcolor="#000000",
            xaxis=dict(
                title=dict(text="X [µm]", font=dict(size=12, color="#ffffff")),
                color="#ffffff",
                gridcolor="#333333",
            ),
            yaxis=dict(
                title=dict(text="Y [µm]", font=dict(size=12, color="#ffffff")),
                color="#ffffff",
                gridcolor="#333333",
            ),
            zaxis=dict(
                title=dict(text="Z [µm]", font=dict(size=12, color="#ffffff")),
                color="#ffffff",
                gridcolor="#333333",
            ),
            aspectmode="manual",
            aspectratio=dict(
                x=1,
                y=1,
                z=max(z_range / xy_max, 0.15),
            ),
            camera=dict(
                eye=dict(
                    x=2.0 * np.cos(np.radians(20)) * np.cos(np.radians(10)),
                    y=2.0 * np.sin(np.radians(20)) * np.cos(np.radians(10)),
                    z=2.0 * np.sin(np.radians(10)) + 0.5,
                ),
            ),
        ),
    ),
)

fig.show()
