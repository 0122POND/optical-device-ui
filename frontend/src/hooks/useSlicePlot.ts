import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import Plotly from "plotly.js-dist-min";
import { colors, fontFamily } from "../utils/constants";
import type { PlotType } from "../types";
import type { PointCloud } from "../utils/pointCloud";
import {
  gridScale,
  physicalGrid,
  physicalPoints,
  type DataSource,
  type ScaleInputs,
} from "../utils/units";
import { bandSection, lineSection, type BandSection } from "../utils/bandSection";

// 2D 断層グラフ（クリックで引いた線に沿った断面：距離×深さ）を sliceRef へ描画する。
// グリッド(zData)がある場合はグリッド交点での線形補間、なければ点群ベースで抽出する。
export function useSlicePlot(args: {
  sliceRef: RefObject<HTMLDivElement | null>;
  showSlice: boolean;
  zData: (number | null)[][] | null;
  cloud: PointCloud | null;
  sliceLineStart: { y: number; z: number } | null;
  sliceLineEnd: { y: number; z: number } | null;
  // 表示中データの出どころと換算設定（µm への換算は utils/units に集約）
  dataSource: DataSource;
  scale: ScaleInputs;
  flipX: boolean;
  flipRef: number;
  plotType: PlotType;
  // 帯の幅[µm]。0 なら線の上だけ、正なら線から ±幅/2 の画素を集めて横から見る（高さマップがあるとき）
  bandWidthUm: number;
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
    dataSource,
    scale,
    flipX,
    flipRef,
    plotType,
    bandWidthUm,
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

    // 列・行の µm ピッチ（クリック座標[µm]→グリッド添字の逆変換に使う）
    const sc = gridScale(dataSource, scale);

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
    // null は値なし（グラフの線はそこで切れる）
    const xData: (number | null)[] = [];
    let band: BandSection | null = null;

    if (zData && zData.length > 0 && bandWidthUm > 0) {
      // --- 帯の断面: 線から ±幅/2 の画素を集め、距離ごとの中央値を断面とする ---
      const grid = physicalGrid(zData, dataSource, scale, flipX, flipRef).z;
      band = bandSection(grid, sc.col, sc.row, sliceLineStart, sliceLineEnd, bandWidthUm);
      tData.push(...band.profT);
      xData.push(...band.profMed);
    } else if (zData && zData.length > 0) {
      // --- 線の断面: 線に沿って一定間隔で双一次補間（3D表示と同じ換算・反転の µm グリッドから取る） ---
      const grid = physicalGrid(zData, dataSource, scale, flipX, flipRef).z;
      const ls = lineSection(grid, sc.col, sc.row, sliceLineStart, sliceLineEnd);
      tData.push(...ls.t);
      xData.push(...ls.v);
    } else if (cloud) {
      // --- フォールバック: 点群ベースの断面抽出（3D表示と同じ換算の µm 座標で） ---
      const pts = physicalPoints(cloud, dataSource, scale, flipX, flipRef);
      let minY = pts.ys[0];
      let maxY = minY;
      let minZ = pts.zs[0];
      let maxZ = minZ;
      for (let i = 1; i < pts.ys.length; i++) {
        if (pts.ys[i] < minY) minY = pts.ys[i];
        if (pts.ys[i] > maxY) maxY = pts.ys[i];
        if (pts.zs[i] < minZ) minZ = pts.zs[i];
        if (pts.zs[i] > maxZ) maxZ = pts.zs[i];
      }
      const tolerance = Math.max(maxY - minY, maxZ - minZ) * 0.02;

      const uy = dy / lineLen;
      const uz = dz / lineLen;

      const slicePoints: { t: number; x: number }[] = [];
      for (let i = 0; i < cloud.y.length; i++) {
        const py = pts.ys[i] - y0;
        const pz = pts.zs[i] - z0;
        const t = py * uy + pz * uz;
        const dist = Math.abs(py * uz - pz * uy);
        if (dist <= tolerance && t >= -tolerance && t <= lineLen + tolerance) {
          slicePoints.push({ t, x: pts.xs[i] });
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

    if (!xData.some((v) => v != null)) {
      Plotly.purge(sliceEl);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = [];
    if (band) {
      // 帯の中の画素（横から見た散らばり）→ P10〜P90 の幅 → 中央値の線 の順に重ねる
      data.push(
        {
          x: band.t,
          y: band.v,
          type: "scattergl",
          mode: "markers",
          marker: { size: 2, color: colors.textMuted, opacity: 0.35 },
          hoverinfo: "skip",
          showlegend: false,
        },
        {
          x: band.profT,
          y: band.profLo,
          type: "scatter",
          mode: "lines",
          line: { width: 0 },
          hoverinfo: "skip",
          showlegend: false,
        },
        {
          x: band.profT,
          y: band.profHi,
          type: "scatter",
          mode: "lines",
          line: { width: 0 },
          fill: "tonexty",
          fillcolor: `${colors.primary}33`,
          hoverinfo: "skip",
          showlegend: false,
        }
      );
    }
    data.push({
      x: tData,
      y: xData,
      type: "scatter",
      mode: "lines",
      line: {
        color: colors.primary,
        width: 1.5,
      },
      showlegend: false,
      ...(band ? { hovertemplate: "距離 %{x:.0f} µm<br>中央値 %{y:.2f}<extra></extra>" } : {}),
    });

    const titleText =
      `断層 (${y0.toFixed(0)},${z0.toFixed(0)})→` +
      `(${y1.toFixed(0)},${z1.toFixed(0)}) µm  ` +
      (band
        ? `帯 ${bandWidthUm} µm・${band.count.toLocaleString()} 画素の中央値（帯 P10〜P90）`
        : `${xData.filter((v) => v != null).length} 点`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout: any = {
      // Plotly 3 は文字列の title を受け付けない（以前は題が出ていなかった）
      title: {
        text: titleText,
        font: { size: 12, color: colors.textMuted },
        x: 0.01,
        xanchor: "left",
      },
      margin: { l: 50, r: 20, t: 40, b: 50 },
      xaxis: { title: { text: "距離 [µm]" }, color: colors.textMuted, gridcolor: colors.grid },
      yaxis: {
        title: {
          text: !sc.valueCalibrated
            ? "高さ [px・未校正]"
            : dataSource === "device"
              ? "深さ [µm]"
              : "高さ [µm]",
        },
        color: colors.textMuted,
        gridcolor: colors.grid,
      },
      height: 250,
      paper_bgcolor: colors.surface,
      plot_bgcolor: "rgba(0,0,0,0)",
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
    dataSource,
    scale,
    flipX,
    flipRef,
    plotType,
    bandWidthUm,
    sliceMeasureMode,
    sliceMeasureStart,
    sliceMeasureEnd,
    setSliceMeasureStart,
    setSliceMeasureEnd,
  ]);
}
