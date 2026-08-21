import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import Plotly from "plotly.js-dist-min";
import { colors, fontFamily } from "../utils/constants";
import type { PlotType } from "../types";
import type { PointCloud } from "../utils/pointCloud";

// 2D 断層グラフ（クリックで引いた線に沿った断面：距離×深さ）を sliceRef へ描画する。
// グリッド(zData)がある場合はグリッド交点での線形補間、なければ点群ベースで抽出する。
export function useSlicePlot(args: {
  sliceRef: RefObject<HTMLDivElement | null>;
  showSlice: boolean;
  zData: (number | null)[][] | null;
  cloud: PointCloud | null;
  sliceLineStart: { y: number; z: number } | null;
  sliceLineEnd: { y: number; z: number } | null;
  sweepInterval: string;
  umPerPixelX: number;
  umPerPixelY: number;
  flipX: boolean;
  plotType: PlotType;
  // 断層グラフ上での2点間距離計測（t=距離[µm], d=深さ[µm]）
  sliceMeasureMode: boolean;
  sliceMeasureStart: { t: number; d: number } | null;
  sliceMeasureEnd: { t: number; d: number } | null;
  setSliceMeasureStart: (p: { t: number; d: number } | null) => void;
  setSliceMeasureEnd: (p: { t: number; d: number } | null) => void;
}) {
  const {
    sliceRef,
    showSlice,
    zData,
    cloud,
    sliceLineStart,
    sliceLineEnd,
    sweepInterval,
    umPerPixelX,
    umPerPixelY,
    flipX,
    plotType,
    sliceMeasureMode,
    sliceMeasureStart,
    sliceMeasureEnd,
    setSliceMeasureStart,
    setSliceMeasureEnd,
  } = args;

  // クリック二重発火/ハンドラ多重化(HMR)でも1クリック=1点になるよう短時間ロック
  const clickLockRef = useRef(false);

  useEffect(() => {
    const sliceEl = sliceRef.current;
    if (!sliceEl) return;

    if (!showSlice || !sliceLineStart || !sliceLineEnd) {
      Plotly.purge(sliceEl);
      return;
    }

    // Z軸の換算係数: 掃引間隔[µm/スライス] (未入力時は umPerPixelY を仮定)
    const sweepVal = parseFloat(sweepInterval);
    const hasSweep = !isNaN(sweepVal) && sweepVal > 0;
    const zUmPerSlice = hasSweep ? sweepVal : umPerPixelY;

    // flipX時の反転用: 3Dプロットと同じmaxRawXを使い深度値を反転
    const maxRawX = flipX && cloud ? cloud.x.reduce((a, b) => (a > b ? a : b), cloud.x[0]) : 0;
    // surfaceモードかつCSV由来: grid値がすでにµm（高さ）なので変換不要
    const isSurfaceCSV = plotType === "surface" && (!cloud || cloud.x.length === 0);
    const depthToUm = (rawVal: number) =>
      isSurfaceCSV ? rawVal : flipX ? (maxRawX - rawVal) * umPerPixelX : rawVal * umPerPixelX;

    // 始点・終点（plotly_clickからµm座標で取得済み）
    const y0 = sliceLineStart.y;
    const z0 = sliceLineStart.z;
    const y1 = sliceLineEnd.y;
    const z1 = sliceLineEnd.z;

    // すでにµm単位のためそのまま使用
    const dy = y1 - y0;
    const dz = z1 - z0;
    const lineLen = Math.sqrt(dy * dy + dz * dz);

    if (lineLen < 1e-6) {
      Plotly.purge(sliceEl);
      return;
    }

    const tData: number[] = [];
    const xData: number[] = [];

    if (zData && zData.length > 0) {
      // --- グリッドベースの断面抽出（グリッド交点での線形補間） ---
      const numRows = zData.length;
      const numCols = zData[0].length;
      // surfaceモードかつCSV由来（cloudなし）: クリック座標がピクセル単位なので変換不要
      const isSurfaceCSV = plotType === "surface" && (!cloud || cloud.x.length === 0);
      // µm→生インデックスへ逆変換（グリッドアクセス用）
      const y0Px = isSurfaceCSV ? y0 : y0 / umPerPixelY;
      const z0Px = isSurfaceCSV ? z0 : z0 / zUmPerSlice;
      const y1Px = isSurfaceCSV ? y1 : y1 / umPerPixelY;
      const z1Px = isSurfaceCSV ? z1 : z1 / zUmPerSlice;
      const dyPx = y1Px - y0Px;
      const dzPx = z1Px - z0Px;

      // 直線がグリッド線と交差する全ての点を収集
      const crossings: { frac: number }[] = [];

      // 始点・終点を追加
      crossings.push({ frac: 0 });
      crossings.push({ frac: 1 });

      // 整数y（列境界）との交点
      if (Math.abs(dyPx) > 1e-9) {
        const yMin = Math.max(0, Math.min(Math.ceil(Math.min(y0Px, y1Px)), numCols - 1));
        const yMax = Math.min(numCols - 1, Math.max(Math.floor(Math.max(y0Px, y1Px)), 0));
        for (let yInt = yMin; yInt <= yMax; yInt++) {
          const f = (yInt - y0Px) / dyPx;
          if (f > 0 && f < 1) crossings.push({ frac: f });
        }
      }

      // 整数z（行境界）との交点
      if (Math.abs(dzPx) > 1e-9) {
        const zMin = Math.max(0, Math.min(Math.ceil(Math.min(z0Px, z1Px)), numRows - 1));
        const zMax = Math.min(numRows - 1, Math.max(Math.floor(Math.max(z0Px, z1Px)), 0));
        for (let zInt = zMin; zInt <= zMax; zInt++) {
          const f = (zInt - z0Px) / dzPx;
          if (f > 0 && f < 1) crossings.push({ frac: f });
        }
      }

      // frac順にソート
      crossings.sort((a, b) => a.frac - b.frac);

      // 各交点で線形補間して深度値を取得
      for (const { frac } of crossings) {
        const py = y0Px + dyPx * frac;
        const pz = z0Px + dzPx * frac;
        const col = Math.round(py);
        const row = Math.round(pz);

        // 直線の主方向に応じて補間方向を決定
        if (Math.abs(dyPx) >= Math.abs(dzPx)) {
          // y方向が主 → 同じrow内でcol間を線形補間
          const c0 = Math.floor(py);
          const c1 = c0 + 1;
          const r = Math.min(Math.max(Math.round(pz), 0), numRows - 1);
          if (c0 >= 0 && c1 < numCols) {
            const v0 = zData[r]?.[c0];
            const v1 = zData[r]?.[c1];
            if (v0 != null && v1 != null) {
              const val = v0 + (v1 - v0) * (py - c0);
              tData.push(lineLen * frac);
              xData.push(depthToUm(val));
              continue;
            }
          }
          // 端点はそのまま
          if (row >= 0 && row < numRows && col >= 0 && col < numCols) {
            const v = zData[row]?.[col];
            if (v != null) {
              tData.push(lineLen * frac);
              xData.push(depthToUm(v));
            }
          }
        } else {
          // z方向が主 → 同じcol内でrow間を線形補間
          const r0 = Math.floor(pz);
          const r1 = r0 + 1;
          const c = Math.min(Math.max(Math.round(py), 0), numCols - 1);
          if (r0 >= 0 && r1 < numRows) {
            const v0 = zData[r0]?.[c];
            const v1 = zData[r1]?.[c];
            if (v0 != null && v1 != null) {
              const val = v0 + (v1 - v0) * (pz - r0);
              tData.push(lineLen * frac);
              xData.push(depthToUm(val));
              continue;
            }
          }
          if (row >= 0 && row < numRows && col >= 0 && col < numCols) {
            const v = zData[row]?.[col];
            if (v != null) {
              tData.push(lineLen * frac);
              xData.push(depthToUm(v));
            }
          }
        }
      }
    } else if (cloud) {
      // --- フォールバック: 点群ベースの断面抽出 ---
      let minY = cloud.y[0] * umPerPixelY;
      let maxY = minY;
      let minZ = cloud.z[0] * zUmPerSlice;
      let maxZ = minZ;
      for (let i = 1; i < cloud.y.length; i++) {
        const yum = cloud.y[i] * umPerPixelY;
        if (yum < minY) minY = yum;
        if (yum > maxY) maxY = yum;
      }
      for (let i = 1; i < cloud.z.length; i++) {
        const zum = cloud.z[i] * zUmPerSlice;
        if (zum < minZ) minZ = zum;
        if (zum > maxZ) maxZ = zum;
      }
      const tolerance = Math.max(maxY - minY, maxZ - minZ) * 0.02;

      const uy = dy / lineLen;
      const uz = dz / lineLen;

      const slicePoints: { t: number; x: number }[] = [];
      for (let i = 0; i < cloud.y.length; i++) {
        const py = cloud.y[i] * umPerPixelY - y0;
        const pz = cloud.z[i] * zUmPerSlice - z0;
        const t = py * uy + pz * uz;
        const dist = Math.abs(py * uz - pz * uy);
        if (dist <= tolerance && t >= -tolerance && t <= lineLen + tolerance) {
          slicePoints.push({ t, x: depthToUm(cloud.x[i]) });
        }
      }
      slicePoints.sort((a, b) => a.t - b.t);

      // 近接t値をグルーピングして平均化
      const mergeThreshold = lineLen / 1000;
      let grpT = 0,
        grpX = 0,
        grpN = 0;
      for (let i = 0; i < slicePoints.length; i++) {
        if (grpN === 0 || slicePoints[i].t - slicePoints[i - 1].t <= mergeThreshold) {
          grpT += slicePoints[i].t;
          grpX += slicePoints[i].x;
          grpN++;
        } else {
          tData.push(grpT / grpN);
          xData.push(grpX / grpN);
          grpT = slicePoints[i].t;
          grpX = slicePoints[i].x;
          grpN = 1;
        }
      }
      if (grpN > 0) {
        tData.push(grpT / grpN);
        xData.push(grpX / grpN);
      }
    }

    if (tData.length === 0) {
      Plotly.purge(sliceEl);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = [
      {
        x: tData,
        y: xData,
        type: "scatter",
        mode: "lines",
        line: {
          color: colors.primary,
          width: 1.5,
        },
      },
    ];

    const titleText =
      `断層 (${y0.toFixed(0)},${z0.toFixed(0)})→` +
      `(${y1.toFixed(0)},${z1.toFixed(0)}) µm  ${tData.length} pts`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout: any = {
      title: titleText,
      margin: { l: 50, r: 20, t: 40, b: 50 },
      xaxis: { title: { text: "距離 [µm]" }, color: colors.text, gridcolor: colors.border },
      yaxis: { title: { text: "深さ [µm]" }, color: colors.text, gridcolor: colors.border },
      height: 250,
      paper_bgcolor: colors.bgDark,
      plot_bgcolor: colors.bgDark,
      font: { color: colors.text, family: fontFamily },
    };

    // 2点間距離計測: ドラッグ可能な線(shape)＋両端の矢じり＋距離ラベル。
    // shape を edits.shapePosition で端点ドラッグ可能にし、長さ・位置を後から調整できる。
    if (sliceMeasureMode && sliceMeasureStart && sliceMeasureEnd) {
      const a = sliceMeasureStart;
      const b = sliceMeasureEnd;
      const dist = Math.sqrt((b.t - a.t) ** 2 + (b.d - a.d) ** 2);
      const fmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(3)} mm` : `${v.toFixed(2)} µm`);
      const arrowColor = "#f59e0b";
      // ドラッグで端点を動かせる線本体
      layout.shapes = [
        {
          type: "line",
          xref: "x",
          yref: "y",
          x0: a.t,
          y0: a.d,
          x1: b.t,
          y1: b.d,
          line: { color: arrowColor, width: 2 },
        },
      ];
      // 両端の矢じり（尾は内側へ短く＝データ座標なので画面上の向きは線に一致）。
      const f = 0.15;
      const head = (x: number, y: number, ax: number, ay: number) => ({
        x,
        y,
        ax,
        ay,
        xref: "x",
        yref: "y",
        axref: "x",
        ayref: "y",
        showarrow: true,
        arrowhead: 3,
        arrowsize: 1.4,
        arrowwidth: 2,
        arrowcolor: arrowColor,
        text: "",
      });
      layout.annotations = [
        head(a.t, a.d, a.t + (b.t - a.t) * f, a.d + (b.d - a.d) * f),
        head(b.t, b.d, b.t + (a.t - b.t) * f, b.d + (a.d - b.d) * f),
        // 距離ラベル（中点直上）
        {
          x: (a.t + b.t) / 2,
          y: (a.d + b.d) / 2,
          xref: "x",
          yref: "y",
          text: `${fmt(dist)}<br>Δ深さ ${fmt(Math.abs(b.d - a.d))}`,
          align: "center",
          showarrow: false,
          yshift: 18,
          font: { color: "#ffffff", size: 13, family: fontFamily },
          bgcolor: "rgba(0,0,0,0.7)",
          bordercolor: arrowColor,
          borderwidth: 1,
          borderpad: 3,
        },
      ];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = {
      responsive: true,
      displaylogo: false,
      // 計測モード中のみ線の端点ドラッグを許可
      edits: { shapePosition: sliceMeasureMode },
    };

    Plotly.newPlot(sliceEl, data, layout, config);

    // 計測モードONのときだけ、プロット領域内の任意クリックで2点を選ぶ → 3点目で測り直し。
    // plotly_click は trace 上の点でしか発火しないため、ネイティブclickでピクセル→データ
    // 座標(p2d)に変換し、曲線上でなくグラフ内ならどこでも計測できるようにする。
    const onAreaClick = (evt: MouseEvent) => {
      if (!sliceMeasureMode) return;
      if (clickLockRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fl = (sliceEl as any)._fullLayout;
      const xa = fl?.xaxis;
      const ya = fl?.yaxis;
      if (!xa || !ya) return;
      const bb = sliceEl.getBoundingClientRect();
      const px = evt.clientX - bb.left - xa._offset;
      const py = evt.clientY - bb.top - ya._offset;
      // プロット領域（軸の内側）外＝余白・軸ラベル上のクリックは無視
      if (px < 0 || px > xa._length || py < 0 || py > ya._length) return;
      const t = xa.p2d(px);
      const d = ya.p2d(py);
      if (!isFinite(t) || !isFinite(d)) return;
      // 2点が確定済みなら、以降のクリックは無視（端点ドラッグで調整／クリアでやり直し）。
      // これで矢印確定後の誤クリックで測り直しになるのを防ぐ。
      if (sliceMeasureStart && sliceMeasureEnd) return;
      clickLockRef.current = true;
      setTimeout(() => {
        clickLockRef.current = false;
      }, 300);
      const pt = { t, d };
      if (!sliceMeasureStart) {
        setSliceMeasureStart(pt);
        setSliceMeasureEnd(null);
      } else {
        setSliceMeasureEnd(pt);
      }
    };
    sliceEl.addEventListener("click", onAreaClick);

    // 端点ドラッグ後の座標を取り込んで距離・矢じり・ラベルを更新する。
    // ズーム/パンの relayout では shape 座標が変わらないため compare で弾く。
    const onRelayout = () => {
      if (!sliceMeasureMode || !sliceMeasureStart || !sliceMeasureEnd) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sh = (sliceEl as any).layout?.shapes?.[0];
      if (!sh || sh.x0 == null || sh.y0 == null || sh.x1 == null || sh.y1 == null) return;
      const eps = 1e-6;
      const changed =
        Math.abs(sh.x0 - sliceMeasureStart.t) > eps ||
        Math.abs(sh.y0 - sliceMeasureStart.d) > eps ||
        Math.abs(sh.x1 - sliceMeasureEnd.t) > eps ||
        Math.abs(sh.y1 - sliceMeasureEnd.d) > eps;
      if (!changed) return;
      setSliceMeasureStart({ t: sh.x0, d: sh.y0 });
      setSliceMeasureEnd({ t: sh.x1, d: sh.y1 });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sliceEl as any).on("plotly_relayout", onRelayout);

    return () => {
      sliceEl.removeEventListener("click", onAreaClick);
      Plotly.purge(sliceEl);
    };
  }, [
    sliceRef,
    showSlice,
    zData,
    cloud,
    sliceLineStart,
    sliceLineEnd,
    sweepInterval,
    umPerPixelX,
    umPerPixelY,
    flipX,
    plotType,
    sliceMeasureMode,
    sliceMeasureStart,
    sliceMeasureEnd,
    setSliceMeasureStart,
    setSliceMeasureEnd,
  ]);
}
