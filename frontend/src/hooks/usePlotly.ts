import { useEffect, useMemo, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import Plotly from "plotly.js-dist-min";
import { DIM_COLORS, FILLED_COLOR, colors, fontFamily, monoFont } from "../utils/constants";
import { buildClippedColorscale, resolveColorRange } from "../utils/colorRange";
import { bandOutline } from "../utils/bandSection";
import { decimateForDisplay } from "../utils/displayGrid";
import type { PointCloud } from "../utils/pointCloud";
import {
  gridScale,
  heightLabel,
  physicalGrid,
  physicalPoints,
  type DataSource,
  type ScaleInputs,
} from "../utils/units";
import type {
  DimLine,
  DimRange,
  DimReadout,
  MeasurePt,
  MeasureState,
  PlotType,
  ViewMode,
} from "../types";

// メイン3D/2D描画（点群 scatter3d / surface / 2D寸法ヒートマップ）と pointGeom memo・
// クリックハンドラ・寸法線ドラッグ(relayout)・カメラ保持(uirevision)を担うフック。
// plotRef と App と共有する ref は引数で受け、描画専用 ref はフック内に持つ。
export function usePlotly(args: {
  plotRef: RefObject<HTMLDivElement | null>;
  measureStateRef: RefObject<MeasureState>;
  dimLinesRef: RefObject<DimLine[]>;
  dimIdRef: RefObject<number>;
  dimRangeRef: RefObject<DimRange | null>;
  shiftHeldRef: RefObject<boolean>;
  showPlot: boolean;
  axisVisible: boolean;
  // true のとき点群(scatter3d)は three.js 側で描くので Plotly では描画しない
  renderPointsWithThree: boolean;
  // true のとき3D表示の Surface は three.js メッシュ側で描くので Plotly では描画しない
  renderSurfaceWithThree: boolean;
  // 点群(3D)の奥行き軸の見た目の強調倍率（1=従来）。値・ホバー・計測は変えない
  depthExaggeration: number;
  // 点群の色分け。confidence は cloud.c（AI の確率 0〜255）を信頼度 0〜1 として塗る
  pointColorBy: "depth" | "confidence";
  cloud: PointCloud | null;
  flipX: boolean;
  viewMode: ViewMode;
  showSlice: boolean;
  sliceLineStart: { y: number; z: number } | null;
  // 断面の帯の幅[µm]（0=線だけ）。2D 表示に帯の外形を描く
  sliceBandUm: number;
  sliceLineEnd: { y: number; z: number } | null;
  // 表示中データの出どころと換算設定（µm への換算は utils/units に集約）。
  // scale は App 側で useMemo して参照を安定させること（描画 effect の依存に入るため）
  dataSource: DataSource;
  scale: ScaleInputs;
  // デバイスデータの左右反転の基準値（全表示で共通の値を使う）
  flipRef: number;
  // カラーレンジの手動指定（µm, 空文字=自動）。レンジ外はグレー表示
  colorRangeMin: string;
  colorRangeMax: string;
  plotType: PlotType;
  zData: (number | null)[][] | null;
  // 後処理の補間で埋めた画素（表示の向き）。印を付けないときは null
  filledMask: boolean[][] | null;
  measureMode: boolean;
  measurePt1: MeasurePt;
  measurePt2: MeasurePt;
  dimensionMode: boolean;
  dimLineVersion: number;
  setDimReadouts: Dispatch<SetStateAction<DimReadout[]>>;
  setMeasurePt1: Dispatch<SetStateAction<MeasurePt>>;
  setMeasurePt2: Dispatch<SetStateAction<MeasurePt>>;
  setSliceLineStart: Dispatch<SetStateAction<{ y: number; z: number } | null>>;
  setSliceLineEnd: Dispatch<SetStateAction<{ y: number; z: number } | null>>;
}) {
  const {
    plotRef,
    measureStateRef,
    dimLinesRef,
    dimIdRef,
    dimRangeRef,
    shiftHeldRef,
    showPlot,
    axisVisible,
    renderPointsWithThree,
    renderSurfaceWithThree,
    depthExaggeration,
    pointColorBy,
    cloud,
    flipX,
    viewMode,
    showSlice,
    sliceLineStart,
    sliceLineEnd,
    sliceBandUm,
    dataSource,
    scale,
    flipRef,
    colorRangeMin,
    colorRangeMax,
    plotType,
    zData,
    filledMask,
    measureMode,
    measurePt1,
    measurePt2,
    dimensionMode,
    dimLineVersion,
    setDimReadouts,
    setMeasurePt1,
    setMeasurePt2,
    setSliceLineStart,
    setSliceLineEnd,
  } = args;

  // 描画専用 ref（クリックハンドラ用の最新値・プロット種別・rAF間引き）
  const measureLockRef = useRef(false);
  const viewModeRef = useRef(viewMode);
  const showSliceRef = useRef(showSlice);
  const sliceLineStartRef = useRef(sliceLineStart);
  const sliceLineEndRef = useRef(sliceLineEnd);
  const sliceBandRef = useRef(sliceBandUm);
  // 断面線・帯の外形の重ね描き（トレース番号と、断面座標→シーン座標の変換）。メインの描画が作り、
  // 線や帯の変更は restyle でこの2本だけ書き換える（以前は1点クリックするたびに面や点群を
  // 丸ごと作り直しており、10円の 1772×1008 で 0.5〜0.7 秒固まっていた）
  // 断層の点を打つためのホバー中の座標（断面の y・z [µm]）と、押した位置（パンのドラッグと区別する）。
  // Plotly は欠損（NaN）のセルでは plotly_click を出さないが hover は出すので、ホバー中の座標と
  // ネイティブの click で点を打つ（以前は欠損の所をクリックしても点が打てなかった）
  const lastHoverRef = useRef<{ y: number; z: number } | null>(null);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const sliceOverlayRef = useRef<{
    idx: [number, number];
    map: (ys: number[], zs: number[]) => { x: number[]; y: number[]; z: number[] };
  } | null>(null);
  const plotKindRef = useRef<"dim" | "surface" | "points" | null>(null);
  const dimRafRef = useRef<number | null>(null);
  const dimApplyingRef = useRef(false);
  // viewMode 切替を検出してカメラを reset するため、前回の viewMode を覚えておく
  const lastViewModeRef = useRef(viewMode);
  // ユーザー操作(plotly_relayout)で確定した3Dカメラを保存し、再描画時に維持する
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const savedCameraRef = useRef<any>(null);
  // 自前の Plotly.react/newPlot によるgl3dシーン再構築中は true。この間に発火する
  // plotly_relayout の scene.camera は Plotly が内部生成した異常値のことがあり、
  // 保存するとクリック後の再描画で視点が飛ぶ（断層の点選択で画面が真っ黒になる症状）。
  const glCamApplyingRef = useRef(false);
  // カラーバーの位置（ドラッグで動かした値を覚え、再描画しても戻らないようにする）。
  // 既定は右下。xanchor=right / yanchor=bottom 基準の paper 座標
  const colorbarPosRef = useRef({ x: 0.995, y: 0.04 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rememberColorbarPos = (e: any) => {
    const u = e?.[0];
    if (!u) return;
    const pick = (k: string) => {
      const v = u[k] ?? u[`marker.${k}`];
      return Array.isArray(v) ? v[0] : v;
    };
    const x = pick("colorbar.x");
    const y = pick("colorbar.y");
    if (typeof x === "number") colorbarPosRef.current.x = x;
    if (typeof y === "number") colorbarPosRef.current.y = y;
  };
  // シーン再構築後の非同期イベントまで抑制期間に含めるための共通ヘルパー
  const markGlCamApplying = () => {
    glCamApplyingRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        glCamApplyingRef.current = false;
      });
    });
  };

  // クリックハンドラ内で参照する状態を毎レンダーで最新化（Plotly.react でハンドラを
  // 貼り直さないため）。カメラ位置は layout.scene.uirevision により Plotly 側で保持される。
  useEffect(() => {
    viewModeRef.current = viewMode;
    showSliceRef.current = showSlice;
    sliceLineStartRef.current = sliceLineStart;
    sliceLineEndRef.current = sliceLineEnd;
    sliceBandRef.current = sliceBandUm;
  });

  // アンマウント時にプロットを破棄（再描画ごとの purge はしない＝react で再利用するため）
  // plotRef は安定参照のため実質マウント時1回のみ実行される。
  useEffect(() => {
    const el = plotRef.current;
    // 2D・断層表示中のクリックで断面の始点・終点を打つ（ホバー中の座標を使う。最新値は ref から読む）
    const onDown = (e: PointerEvent) => {
      downPosRef.current = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      if (viewModeRef.current !== "2D-camera" || !showSliceRef.current) return;
      if (measureStateRef.current.mode) return; // 距離計測のクリックは plotly_click 側で扱う
      const d = downPosRef.current;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return; // パンのドラッグ
      const pt = lastHoverRef.current;
      if (!pt) return;
      if (!sliceLineStartRef.current || (sliceLineStartRef.current && sliceLineEndRef.current)) {
        setSliceLineStart(pt);
        setSliceLineEnd(null);
      } else {
        setSliceLineEnd(pt);
      }
    };
    el?.addEventListener("pointerdown", onDown);
    el?.addEventListener("click", onClick);
    return () => {
      el?.removeEventListener("pointerdown", onDown);
      el?.removeEventListener("click", onClick);
      if (dimRafRef.current != null) cancelAnimationFrame(dimRafRef.current);
      if (el) Plotly.purge(el);
    };
  }, [plotRef, measureStateRef, setSliceLineStart, setSliceLineEnd]);

  // 点群(scatter3d)の物理座標(µm)変換と範囲。最大12万点×3配列の生成は重いので memo 化し、
  // 入力(cloud/反転/換算係数)が変わらない限り同じ配列参照を返す。これにより描画 effect が
  // 軸表示・計測マーカー等の無関係な state で再実行されても、Plotly.react は点群トレースを
  // 「変化なし」と判定して WebGL バッファの再アップロードを省略できる。
  const pointGeom = useMemo(() => {
    if (!cloud || cloud.x.length === 0) return null;
    // 物理単位（µm）に変換（出どころ別の換算・反転は utils/units に集約）
    const {
      xs: xDataUm,
      ys: yDataUm,
      zs: zDataUm,
    } = physicalPoints(cloud, dataSource, scale, flipX, flipRef);
    // µm範囲を算出（aspectratio・カラーバー・断面ライン等で使用）
    let xUmMin = xDataUm[0],
      xUmMax = xDataUm[0];
    let yUmMin = yDataUm[0],
      yUmMax = yDataUm[0];
    let zUmMin = zDataUm[0],
      zUmMax = zDataUm[0];
    for (let i = 1; i < xDataUm.length; i++) {
      if (xDataUm[i] < xUmMin) xUmMin = xDataUm[i];
      if (xDataUm[i] > xUmMax) xUmMax = xDataUm[i];
      if (yDataUm[i] < yUmMin) yUmMin = yDataUm[i];
      if (yDataUm[i] > yUmMax) yUmMax = yDataUm[i];
      if (zDataUm[i] < zUmMin) zUmMin = zDataUm[i];
      if (zDataUm[i] > zUmMax) zUmMax = zDataUm[i];
    }
    return { xDataUm, yDataUm, zDataUm, xUmMin, xUmMax, yUmMin, yUmMax, zUmMin, zUmMax };
  }, [cloud, dataSource, scale, flipX, flipRef]);

  useEffect(() => {
    const plotEl = plotRef.current;
    // 断面線・帯の重ね描きは、この描画で作ったときだけ有効（作らない表示では restyle しない）
    sliceOverlayRef.current = null;
    lastHoverRef.current = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pushSliceOverlay = (traces: any[], map: (ys: number[], zs: number[]) => any) => {
      const [line, outline] = sliceOverlayData(
        sliceLineStartRef.current,
        sliceLineEndRef.current,
        sliceBandRef.current,
        map
      );
      sliceOverlayRef.current = { idx: [traces.length, traces.length + 1], map };
      traces.push(
        {
          type: "scatter3d",
          mode: "lines+markers",
          ...line,
          line: { color: "#ff4444", width: 3 },
          marker: { size: 5, color: "#ff4444" },
          showlegend: false,
          hoverinfo: "skip",
        },
        {
          type: "scatter3d",
          mode: "lines",
          ...outline,
          line: { color: "#ff4444", width: 2, dash: "dash" },
          showlegend: false,
          hoverinfo: "skip",
        }
      );
    };
    if (!plotEl) return;

    if (!showPlot) {
      Plotly.purge(plotEl);
      plotKindRef.current = null;
      return;
    }

    // three.js エンジンが点群を担当する間は Plotly を描かない（二重描画・負荷回避）
    if (
      (renderPointsWithThree && plotType === "scatter3d") ||
      (renderSurfaceWithThree && plotType === "surface" && viewMode === "3D")
    ) {
      Plotly.purge(plotEl);
      plotKindRef.current = null;
      return;
    }

    // クリック等で点群以外のトレースが増減する再描画では _scene が作り直され、
    // uirevision だけではズーム/パンが初期視点に戻ってしまう。そこでユーザー操作
    // (plotly_relayout) 時の実カメラを savedCameraRef に保存し、それを再適用して維持する。
    // 毎回 getCamera で読み直すと微小にドリフトするため、保存済みカメラを冪等に使う。
    // viewMode 切替時のみ savedCameraRef を捨てて各ビューの既定カメラ(cam)へリセット。
    if (viewMode !== lastViewModeRef.current) {
      savedCameraRef.current = null;
      lastViewModeRef.current = viewMode;
    }

    // 距離計測の数値ラベル: 2点が揃ったら計測線(破線)の中点に距離を浮かせる。
    // 3Dシーンの scene.annotations を使い、右パネルではなくグラフ上(棒の上)に表示する。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const measureSceneAnnotations: any[] =
      measureMode && measurePt1 && measurePt2
        ? [
            {
              x: (measurePt1.x + measurePt2.x) / 2,
              y: (measurePt1.y + measurePt2.y) / 2,
              z: (measurePt1.z + measurePt2.z) / 2,
              text: (() => {
                const d = Math.sqrt(
                  (measurePt2.x - measurePt1.x) ** 2 +
                    (measurePt2.y - measurePt1.y) ** 2 +
                    (measurePt2.z - measurePt1.z) ** 2
                );
                const label = d >= 1000 ? `${(d / 1000).toFixed(3)} mm` : `${d.toFixed(2)} µm`;
                // 高さが未校正の px だと、高さ方向を含む距離は物理的に意味を持たない
                return gridScale(dataSource, scale).valueCalibrated
                  ? label
                  : `${label}（高さ未校正）`;
              })(),
              showarrow: false,
              font: { color: "#ffffff", size: 13, family: fontFamily },
              bgcolor: "rgba(0,0,0,0.7)",
              bordercolor: colors.primary,
              borderwidth: 1,
              borderpad: 3,
              yshift: 12,
            },
          ]
        : [];

    // ---- 寸法測定モード（2D 本物のヒートマップ + ドラッグ可能な両矢印）----
    // 3Dシーンには編集可能図形が無いため、寸法測定中だけ真の2Dヒートマップで描画する。
    if (viewMode === "2D-camera" && dimensionMode && zData && zData.length > 0) {
      // 物理単位（µm）のグリッド。出どころ（デバイス/CSV）別の換算は utils/units に集約
      const pg = physicalGrid(zData, dataSource, scale, flipX, flipRef);
      const surfXCoords = pg.x;
      const surfYCoords = pg.y;
      const surfaceZ = pg.z;
      const xLabel = pg.xLabel;
      const yLabel = pg.yLabel;
      const zLabel = pg.zLabel;
      const planeUnit = "µm";

      // カラーレンジ（手動指定 or 自動ロバスト、レンジ外はグレー）
      const dimVals: number[] = [];
      for (const row of surfaceZ) {
        for (const v of row) {
          if (v != null) dimVals.push(v);
        }
      }
      const dimColor = buildClippedColorscale(
        resolveColorRange(dimVals, colorRangeMin, colorRangeMax)
      );

      const xMin = Math.min(surfXCoords[0], surfXCoords[surfXCoords.length - 1]);
      const xMax = Math.max(surfXCoords[0], surfXCoords[surfXCoords.length - 1]);
      const yMin = surfYCoords[0];
      const yMax = surfYCoords[surfYCoords.length - 1];

      dimRangeRef.current = { xMin, xMax, yMin, yMax };

      // 寸法線の初期位置（保存値が範囲内ならそれを使う。無ければ中央に水平配置）
      const inRange = (l: DimLine) =>
        l.x0 >= xMin &&
        l.x0 <= xMax &&
        l.x1 >= xMin &&
        l.x1 <= xMax &&
        l.y0 >= yMin &&
        l.y0 <= yMax &&
        l.y1 >= yMin &&
        l.y1 <= yMax;
      let lines = dimLinesRef.current.filter(inRange);
      if (lines.length === 0) {
        lines = [
          {
            id: ++dimIdRef.current,
            x0: xMin + (xMax - xMin) * 0.25,
            x1: xMin + (xMax - xMin) * 0.75,
            y0: yMin + (yMax - yMin) * 0.5,
            y1: yMin + (yMax - yMin) * 0.5,
          },
        ];
      }
      dimLinesRef.current = lines;

      const fmtVal = (v: number) => {
        if (planeUnit === "µm") {
          return v >= 1000
            ? `${v.toFixed(1)} µm (${(v / 1000).toFixed(3)} mm)`
            : `${v.toFixed(1)} µm`;
        }
        return `${v.toFixed(1)} px`;
      };

      // ラベルの表示位置（データ座標）。手動位置(lx/ly)があればそれを、無ければ
      // 線の中点から直交方向に少し離した既定位置を返す。
      const labelGap = (xMax - xMin) * 0.05 || 1;
      const renderedLabelPos = (l: DimLine) => {
        if (l.lx != null && l.ly != null) return { x: l.lx, y: l.ly };
        const mx = (l.x0 + l.x1) / 2;
        const my = (l.y0 + l.y1) / 2;
        const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0) || 1;
        const px = -(l.y1 - l.y0) / len;
        const py = (l.x1 - l.x0) / len;
        return { x: mx + px * labelGap, y: my + py * labelGap };
      };

      const buildShapes = (ls: DimLine[]) =>
        ls.map((l, idx) => ({
          type: "line",
          xref: "x",
          yref: "y",
          x0: l.x0,
          y0: l.y0,
          x1: l.x1,
          y1: l.y1,
          line: { color: DIM_COLORS[idx % DIM_COLORS.length], width: 2 },
        }));

      const buildAnnotations = (ls: DimLine[]) => {
        const multi = ls.length > 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ann: any[] = [];
        ls.forEach((l, idx) => {
          const color = DIM_COLORS[idx % DIM_COLORS.length];
          const dist = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
          // 線方向の単位ベクトル（データ座標）。画面のyは下向き正なので矢じり尾の
          // ピクセルオフセットではyを反転する。
          const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0) || 1;
          const ux = (l.x1 - l.x0) / len;
          const uy = (l.y1 - l.y0) / len;
          const AR = 22; // 矢じりの長さ（px）。端点近傍だけに収め、線本体のドラッグを邪魔しない
          const arrowBase = {
            xref: "x",
            yref: "y",
            axref: "pixel",
            ayref: "pixel",
            showarrow: true,
            arrowhead: 3,
            arrowsize: 1.4,
            arrowwidth: 2,
            arrowcolor: color,
            text: "",
          };
          // 端点0に外向きの短い矢じり（尾は内側=端点1方向）
          ann.push({ ...arrowBase, x: l.x0, y: l.y0, ax: ux * AR, ay: -uy * AR });
          // 端点1に外向きの短い矢じり（尾は内側=端点0方向）
          ann.push({ ...arrowBase, x: l.x1, y: l.y1, ax: -ux * AR, ay: uy * AR });
          // 寸法ラベル（ドラッグで自由に移動可。複数本のときは番号付き）
          const lp = renderedLabelPos(l);
          ann.push({
            x: lp.x,
            y: lp.y,
            xref: "x",
            yref: "y",
            showarrow: false,
            captureevents: true,
            text: multi ? `${idx + 1}. ${fmtVal(dist)}` : fmtVal(dist),
            font: { color: "#ffffff", size: 14 },
            bgcolor: "rgba(0,0,0,0.65)",
            bordercolor: color,
            borderwidth: 1,
            borderpad: 4,
          });
        });
        return ann;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dimData: any[] = [
        {
          type: "heatmap",
          x: surfXCoords,
          y: surfYCoords,
          z: surfaceZ,
          colorscale: dimColor.colorscale,
          zmin: dimColor.cmin,
          zmax: dimColor.cmax,
          zsmooth: false,
          connectgaps: false,
          colorbar: {
            // モック準拠: 右下に細く置き、単位は上に
            x: colorbarPosRef.current.x,
            xanchor: "right",
            y: colorbarPosRef.current.y,
            yanchor: "bottom",
            len: 0.34,
            thickness: 8,
            outlinewidth: 0,
            ypad: 0,
            tickfont: { color: colors.textMuted, family: monoFont, size: 10.5 },
            title: { text: zLabel, font: { color: colors.textDim, size: 10.5 }, side: "top" },
          },
          hovertemplate: `${xLabel}: %{x:.1f}<br>${yLabel}: %{y:.1f}<br>${zLabel}: %{z:.2f}<extra></extra>`,
        },
      ];
      if (filledMask) {
        dimData.push({
          type: "heatmap",
          x: surfXCoords,
          y: surfYCoords,
          z: filledMask.map((row) => row.map((f) => (f ? 1 : null))),
          colorscale: [
            [0, FILLED_COLOR],
            [1, FILLED_COLOR],
          ],
          opacity: 0.55,
          showscale: false,
          hoverinfo: "skip",
          zsmooth: false,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dimLayout: any = {
        autosize: true,
        margin: { l: 50, r: 10, t: 30, b: 45 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        dragmode: "pan",
        xaxis: {
          title: { text: xLabel, font: { size: 12, color: colors.textMuted } },
          color: colors.textMuted,
          gridcolor: colors.grid,
          zeroline: false,
          constrain: "domain",
        },
        yaxis: {
          title: { text: yLabel, font: { size: 12, color: colors.textMuted } },
          color: colors.textMuted,
          gridcolor: colors.grid,
          zeroline: false,
          scaleanchor: "x",
          scaleratio: 1,
        },
        shapes: buildShapes(lines),
        annotations: buildAnnotations(lines),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dimConfig: any = {
        responsive: true,
        displaylogo: false,
        displayModeBar: true,
        scrollZoom: true, // ホイールでズームイン/アウト（寸法線ドラッグと両立）
        modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
        editable: false,
        edits: { shapePosition: true, annotationPosition: true, colorbarPosition: true },
      };

      // 寸法測定の relayout ハンドラは tol などその場のクロージャに依存するため、
      // react での流用はせず常に貼り直す（purge で旧ハンドラ・旧トレースを除去）
      // 旧 plotEl を掴む保留中の rAF が残っていれば破棄する
      if (dimRafRef.current != null) {
        cancelAnimationFrame(dimRafRef.current);
        dimRafRef.current = null;
      }
      dimApplyingRef.current = false;
      Plotly.purge(plotEl);
      Plotly.newPlot(plotEl, dimData, dimLayout, dimConfig);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (plotEl as any).on("plotly_restyle", rememberColorbarPos);
      plotKindRef.current = "dim";

      const toReadouts = (ls: DimLine[]) =>
        ls.map((l) => ({
          id: l.id,
          dist: Math.hypot(l.x1 - l.x0, l.y1 - l.y0),
          dx: Math.abs(l.x1 - l.x0),
          dy: Math.abs(l.y1 - l.y0),
          unit: planeUnit,
        }));
      setDimReadouts(toReadouts(lines));

      // 物理座標の桁が大きい(µm)ため、変化検出は範囲基準の相対許容で行う
      const tol = Math.max(1e-6, (xMax - xMin) * 1e-4);
      const differs = (a: number, b: number) => Math.abs(a - b) > tol;
      // 動かした端点(mx,my)を固定端点(fx,fy)に対し水平/垂直へスナップ（Shift押下時）
      const snap = (mx: number, my: number, fx: number, fy: number) =>
        Math.abs(mx - fx) < Math.abs(my - fy)
          ? { x: fx, y: my } // X差が小 → 垂直に固定
          : { x: mx, y: fy }; // Y差が小 → 水平に固定
      // ドラッグ中は plotly_relayout が毎フレーム多発するため、rAF で1フレーム1回に間引く。
      // 自前の Plotly.relayout が誘発する relayout は dimApplyingRef で弾きループを断つ。
      const processRelayout = () => {
        dimRafRef.current = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const layout = (plotEl as any).layout;
        const shapes = layout?.shapes;
        const anns = layout?.annotations;
        const cur = dimLinesRef.current;
        let changed = false;
        const updated = cur.map((l, i) => {
          let nl = l;
          // 1) 線(shape)のドラッグ: 端点や全体移動。ラベルは中点の移動量だけ追従
          const sh = shapes?.[i];
          let shapeChanged = false;
          if (sh && sh.x0 != null && sh.y0 != null && sh.x1 != null && sh.y1 != null) {
            const e0moved = differs(l.x0, sh.x0) || differs(l.y0, sh.y0);
            const e1moved = differs(l.x1, sh.x1) || differs(l.y1, sh.y1);
            if (e0moved || e1moved) {
              let nx0 = sh.x0,
                ny0 = sh.y0,
                nx1 = sh.x1,
                ny1 = sh.y1;
              // Shift中の単一端点ドラッグは直交スナップ（両端移動=平行移動は対象外）
              if (shiftHeldRef.current && e0moved && !e1moved) {
                const s = snap(nx0, ny0, nx1, ny1);
                nx0 = s.x;
                ny0 = s.y;
              } else if (shiftHeldRef.current && e1moved && !e0moved) {
                const s = snap(nx1, ny1, nx0, ny0);
                nx1 = s.x;
                ny1 = s.y;
              }
              const dmx = (nx0 + nx1) / 2 - (l.x0 + l.x1) / 2;
              const dmy = (ny0 + ny1) / 2 - (l.y0 + l.y1) / 2;
              nl = {
                ...nl,
                x0: nx0,
                y0: ny0,
                x1: nx1,
                y1: ny1,
                lx: nl.lx != null ? nl.lx + dmx : nl.lx,
                ly: nl.ly != null ? nl.ly + dmy : nl.ly,
              };
              shapeChanged = true;
              changed = true;
            }
          }
          // 2) 注釈(矢じり/ラベル)のドラッグ。線ドラッグと同時には起きない前提
          if (!shapeChanged && anns) {
            const a0 = anns[3 * i]; // 端点0の矢じり
            const a1 = anns[3 * i + 1]; // 端点1の矢じり
            const al = anns[3 * i + 2]; // ラベル
            // 矢じりドラッグ → 端点を移動（Shift中は固定端点に対し直交スナップ）
            if (
              a0 &&
              a0.x != null &&
              a0.y != null &&
              (differs(a0.x, nl.x0) || differs(a0.y, nl.y0))
            ) {
              const p = shiftHeldRef.current
                ? snap(a0.x, a0.y, nl.x1, nl.y1)
                : { x: a0.x, y: a0.y };
              nl = { ...nl, x0: p.x, y0: p.y };
              changed = true;
            }
            if (
              a1 &&
              a1.x != null &&
              a1.y != null &&
              (differs(a1.x, nl.x1) || differs(a1.y, nl.y1))
            ) {
              const p = shiftHeldRef.current
                ? snap(a1.x, a1.y, nl.x0, nl.y0)
                : { x: a1.x, y: a1.y };
              nl = { ...nl, x1: p.x, y1: p.y };
              changed = true;
            }
            // ラベルドラッグ → 表示位置を記憶
            if (al && al.x != null && al.y != null) {
              const rp = renderedLabelPos(nl);
              if (differs(al.x, rp.x) || differs(al.y, rp.y)) {
                nl = { ...nl, lx: al.x, ly: al.y };
                changed = true;
              }
            }
          }
          return nl;
        });
        // ズーム/パンでは何も変わらない → 再描画せずループ防止
        if (!changed) return;
        dimLinesRef.current = updated;
        setDimReadouts(toReadouts(updated));
        // この relayout 自身が誘発する plotly_relayout は無視する（フラグは完了後に解除）
        dimApplyingRef.current = true;
        Plotly.relayout(plotEl, {
          shapes: buildShapes(updated),
          annotations: buildAnnotations(updated),
        }).then(
          () => {
            dimApplyingRef.current = false;
          },
          () => {
            dimApplyingRef.current = false;
          }
        );
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (plotEl as any).on("plotly_relayout", () => {
        if (dimApplyingRef.current) return; // 自前の relayout が起こしたイベントは処理しない
        if (dimRafRef.current != null) return; // 同フレーム内の多重発火を1回に集約
        dimRafRef.current = requestAnimationFrame(processRelayout);
      });

      // 再描画ごとの purge はしない（次回 effect 冒頭の種別判定で制御）
      return;
    }

    // surfaceモード: zDataのグリッドをsurfaceプロットで描画
    // 光学デバイスのグリッド: grid[zSlice][yPixel] = xCentroid
    //   → Keyence風に座標変換: X軸=Y方向[µm], Y軸=Z走査方向[µm], Z軸(高さ)=X深度[µm]
    // CSV読み込み（Keyence等）: grid[row][col] = height → そのまま表示
    if (plotType === "surface" && zData && zData.length > 0) {
      // 物理単位（µm）のグリッド。出どころ（デバイス/CSV）は読込経路で明示されたものを使う
      // （以前は「点群があればデバイス由来」と推測しており、CSVでも点群を作るため
      //  CSVの高さに X軸 µm/pix が掛かっていた）
      const pg = physicalGrid(zData, dataSource, scale, flipX, flipRef);
      // 表示だけ間引く（Plotly の 3D は更新のたびに全セルを計算し直すため。utils/displayGrid）
      const dg = decimateForDisplay(pg.x, pg.y, pg.z, filledMask);
      const surfXCoords = dg.x;
      const surfYCoords = dg.y;
      const surfaceZ = dg.z;
      const shownFilled = dg.mask;
      const xLabel = pg.xLabel;
      const yLabel = pg.yLabel;
      const zLabel = pg.zLabel;

      // 高さ範囲を計算（変換後の値から。hMin/hMax はアスペクト比等のジオメトリ用）
      let hMin = Infinity,
        hMax = -Infinity;
      const surfVals: number[] = [];
      for (const row of surfaceZ) {
        for (const v of row) {
          if (v == null) continue;
          if (v < hMin) hMin = v;
          if (v > hMax) hMax = v;
          surfVals.push(v);
        }
      }

      // カラーレンジ（手動指定 or 自動ロバスト、レンジ外はグレー）
      const surfColor = buildClippedColorscale(
        resolveColorRange(surfVals, colorRangeMin, colorRangeMax)
      );

      // 軸の物理範囲
      const xRange = surfXCoords[surfXCoords.length - 1] - surfXCoords[0] || 1;
      const yRange = surfYCoords[surfYCoords.length - 1] - surfYCoords[0] || 1;
      const hRange = hMax - hMin || 1;
      const xyMax = Math.max(xRange, yRange);

      const cam =
        viewMode === "2D-camera"
          ? { eye: { x: 0, y: 0, z: 2.5 }, up: { x: 0, y: 1, z: 0 } }
          : (() => {
              const azim = 20;
              const elev = 10;
              const az = (azim * Math.PI) / 180;
              const el = (elev * Math.PI) / 180;
              return {
                eye: {
                  x: 2.0 * Math.cos(az) * Math.cos(el),
                  y: 2.0 * Math.sin(az) * Math.cos(el),
                  z: 2.0 * Math.sin(el) + 0.5,
                },
              };
            })();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const surfData: any[] = [
        {
          type: "surface",
          x: surfXCoords,
          y: surfYCoords,
          z: surfaceZ,
          colorscale: surfColor.colorscale,
          cmin: surfColor.cmin,
          cmax: surfColor.cmax,
          showscale: true,
          colorbar: {
            // モック準拠: 右下に細く置き、単位は上に
            x: colorbarPosRef.current.x,
            xanchor: "right",
            y: colorbarPosRef.current.y,
            yanchor: "bottom",
            len: 0.34,
            thickness: 8,
            outlinewidth: 0,
            ypad: 0,
            tickfont: { color: colors.textMuted, family: monoFont, size: 10.5 },
            title: { text: zLabel, font: { color: colors.textDim, size: 10.5 }, side: "top" },
          },
          contours: {
            z: { show: false },
          },
        },
      ];
      // 補間で埋めた画素に点の印を重ねる（多いときは間引いて最大約2万点。形が隠れないよう小さく半透明に）
      if (shownFilled) {
        const fx: number[] = [];
        const fy: number[] = [];
        const fz: number[] = [];
        let nFilled = 0;
        for (const row of shownFilled) for (const f of row) if (f) nFilled++;
        const stride = Math.max(1, Math.ceil(Math.sqrt(nFilled / 20000)));
        for (let r = 0; r < shownFilled.length; r += stride)
          for (let c = 0; c < shownFilled[r].length; c += stride) {
            const v = surfaceZ[r]?.[c];
            if (!shownFilled[r][c] || v == null) continue;
            fx.push(surfXCoords[c]);
            fy.push(surfYCoords[r]);
            fz.push(v);
          }
        surfData.push({
          type: "scatter3d",
          mode: "markers",
          x: fx,
          y: fy,
          z: fz,
          marker: { size: 1, color: FILLED_COLOR, opacity: 0.6 },
          hoverinfo: "skip",
          showlegend: false,
        });
      }

      // 描画種別の切替(points⇄surface)ではカメラ規約が異なる（surfaceはz方向・points
      // はx方向から見る）ため、保存カメラを破棄してこのビューの既定カメラから始める
      if (plotKindRef.current !== "surface") savedCameraRef.current = null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const surfLayout: any = {
        title: "",
        autosize: true,
        margin: { l: 0, r: 0, t: 30, b: 0 },
        paper_bgcolor: "rgba(0,0,0,0)",
        scene: {
          bgcolor: "rgba(0,0,0,0)",
          // 2D（真上から）は横・縦の2軸だけ出し、高さ軸は色バーで読む（高さ軸を出すと、潰れた箱の
          // 目盛りと題が図の下に重なって崩れていた）。目盛りの文字は斜めにしない
          // 2D の縦軸の題は目盛りに重なる（3Dシーンの題は位置をずらせない）ので、横軸の題にまとめる
          xaxis: {
            title: axisVisible
              ? {
                  text:
                    viewMode === "2D-camera"
                      ? `${xLabel.replace(/ \[.*\]$/, "")}・${yLabel}`
                      : xLabel,
                  font: { size: 12, color: colors.textMuted },
                }
              : "",
            visible: axisVisible,
            showgrid: axisVisible,
            zeroline: axisVisible,
            color: colors.textMuted,
            gridcolor: colors.grid,
            ...(viewMode === "2D-camera" ? { tickangle: 0, nticks: 5 } : {}),
          },
          yaxis: {
            title:
              axisVisible && viewMode !== "2D-camera"
                ? { text: yLabel, font: { size: 12, color: colors.textMuted } }
                : { text: "" }, // "" だと Plotly が軸名「y」を出す
            visible: axisVisible,
            showgrid: axisVisible,
            zeroline: axisVisible,
            color: colors.textMuted,
            gridcolor: colors.grid,
            ...(viewMode === "2D-camera" ? { tickangle: 0 } : {}),
          },
          zaxis: {
            title: axisVisible ? { text: zLabel, font: { size: 12, color: colors.textMuted } } : "",
            visible: viewMode === "3D" && axisVisible,
            showgrid: viewMode === "3D" && axisVisible,
            zeroline: viewMode === "3D" && axisVisible,
            color: colors.textMuted,
            gridcolor: colors.grid,
          },
          aspectmode: "manual",
          aspectratio:
            viewMode === "2D-camera"
              ? { x: xRange / xyMax, y: yRange / xyMax, z: 0.01 }
              : {
                  x: xRange / xyMax,
                  y: yRange / xyMax,
                  z: Math.max(hRange / xyMax, 0.15),
                },
          camera: savedCameraRef.current || cam,
          // viewMode が同じ間は react 後もカメラ操作を保持し、切替時のみ cam にリセット
          uirevision: viewMode,
          annotations: measureSceneAnnotations,
          ...(viewMode === "2D-camera" ? { dragmode: "pan" } : {}),
        },
      };

      // 2Dモード + 断層表示時、クリックで決めた始点・終点のラインと帯の外形（面より手前に置く）
      if (viewMode === "2D-camera" && showSlice) {
        const frontZ = hMax + hRange * 0.05;
        pushSliceOverlay(surfData, (ys, zs) => ({ x: ys, y: zs, z: ys.map(() => frontZ) }));
      }

      // 距離計測マーカー
      if (measureMode && measurePt1) {
        const ms = measureStateRef.current;
        surfData.push({
          type: "scatter3d",
          mode: ms.pt2 ? "markers+lines" : "markers",
          x: ms.pt2 ? [measurePt1.x, ms.pt2.x] : [measurePt1.x],
          y: ms.pt2 ? [measurePt1.y, ms.pt2.y] : [measurePt1.y],
          z: ms.pt2 ? [measurePt1.z, ms.pt2.z] : [measurePt1.z],
          marker: { size: 3, color: "#ffffff", symbol: "diamond" },
          line: { color: "#ffffff", width: 4, dash: "dash" },
          showlegend: false,
          hoverinfo: "skip",
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config: any = {
        responsive: true,
        displaylogo: false,
        displayModeBar: false,
        // カラーバーはドラッグで好きな位置へ動かせる
        edits: { colorbarPosition: true },
      };
      // surface は react だとクリックのヒットテストが更新されず、2点目が1点目と同じ座標を
      // 返す不具合がある。グリッドは軽いので常に purge+newPlot で作り直す（カメラは
      // savedCameraRef→layout.camera で維持されるため視点は戻らない）。
      {
        markGlCamApplying();
        Plotly.purge(plotEl);
        Plotly.newPlot(plotEl, surfData, surfLayout, config);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (plotEl as any).on("plotly_restyle", rememberColorbarPos);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (plotEl as any).on("plotly_click", (eventData: any) => {
          if (!eventData.points || eventData.points.length === 0) return;
          const p = eventData.points[0];

          // 距離計測モード
          if (measureStateRef.current.mode) {
            const s = measureStateRef.current;
            if (s.pt1 && s.pt2) return;
            // 高さの無い点（欠損のセル）は距離にできないので無視する（以前は表示で落ちていた）
            if (![p.x, p.y, p.z].every((v) => typeof v === "number" && isFinite(v))) return;
            if (measureLockRef.current) return;
            measureLockRef.current = true;
            const pt3 = { x: p.x as number, y: p.y as number, z: p.z as number };
            if (!s.pt1) {
              measureStateRef.current = { ...s, pt1: pt3 };
              setMeasurePt1(pt3);
            } else {
              measureStateRef.current = { ...s, pt2: pt3 };
              setMeasurePt2(pt3);
            }
            setTimeout(() => {
              measureLockRef.current = false;
            }, 300);
            return;
          }

          // 断層の点はここでは打たない（欠損のセルでは plotly_click が起きないため、下の hover＋
          // ネイティブの click で打つ）
        });
        // 断層の点の候補: ホバー中のセルの座標（欠損のセルでも hover は起きる）
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (plotEl as any).on("plotly_hover", (e: any) => {
          const p = e?.points?.[0];
          if (p) lastHoverRef.current = { y: p.x as number, z: p.y as number };
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (plotEl as any).on("plotly_unhover", () => {
          lastHoverRef.current = null;
        });
        // ユーザーのズーム/パン(カメラ操作)を保存し、後続の再描画で維持する。
        // シーン再構築中に Plotly 自身が発火させる relayout は保存しない
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (plotEl as any).on("plotly_relayout", (e: any) => {
          if (glCamApplyingRef.current) return;
          const c = e?.["scene.camera"];
          if (c) savedCameraRef.current = c;
        });
        plotKindRef.current = "surface";
      }

      // 再描画ごとの purge はしない（react 再利用のため）
      return;
    }

    if (!cloud) {
      Plotly.purge(plotEl);
      plotKindRef.current = null;
      return;
    }

    // 物理座標(µm)変換と範囲は pointGeom(memo) を再利用。参照が安定するため、
    // 無関係な state 変化での再描画では Plotly.react が点群バッファを再アップロードしない。
    if (!pointGeom) {
      Plotly.purge(plotEl);
      plotKindRef.current = null;
      return;
    }
    const { xDataUm, yDataUm, zDataUm, xUmMin, xUmMax, yUmMin, yUmMax, zUmMin, zUmMax } = pointGeom;

    // 行方向のピッチが指定されているか（軸ラベルの表示分岐に使用）
    const hasSweep = !gridScale(dataSource, scale).rowAssumed;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let layout: any;

    {
      const cam =
        viewMode === "2D-camera"
          ? { eye: { x: 2.0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } }
          : (() => {
              const azim = 20;
              const elev = 10;
              const az = (azim * Math.PI) / 180;
              const el = (elev * Math.PI) / 180;
              return {
                eye: {
                  x: 2.0 * Math.cos(az) * Math.cos(el),
                  y: 2.0 * Math.sin(az) * Math.cos(el),
                  z: 2.0 * Math.sin(el) + 0.5,
                },
              };
            })();

      // カラーレンジ（手動指定 or 自動ロバスト、レンジ外はグレー）
      // 信頼度で色分けするときは AI の確率（cloud.c, 0〜255）を 0〜1 で固定レンジに塗る
      const byConfidence = pointColorBy === "confidence" && !!cloud;
      const pointColor = byConfidence
        ? buildClippedColorscale({ lo: 0, hi: 1, min: 0, max: 1 })
        : buildClippedColorscale(resolveColorRange(xDataUm, colorRangeMin, colorRangeMax));

      // カラーバーのカスタムtick（最大値のみ単位表示、colorDataはµm単位）。
      // tickはグレー帯を除いたグラデーション範囲 [lo, hi] に振る
      const colorData = byConfidence ? cloud!.c.map((v) => v / 255) : xDataUm;
      const cMin = pointColor.lo;
      const cMax = pointColor.hi;
      // mm超えたらmm表示（未校正の px はそのまま px）
      const valueCalibrated = gridScale(dataSource, scale).valueCalibrated;
      const useMillimeter = valueCalibrated && cMax >= 1000;
      const unitLabel = !valueCalibrated ? "px" : useMillimeter ? "mm" : "µm";
      const toUnit = (um: number) => (useMillimeter ? um / 1000 : um);
      // キリの良い数値でtickを生成
      const rangeUnit = toUnit(cMax) - toUnit(cMin);
      const rawStep = rangeUnit / 5;
      // 1, 2, 5 の倍数に丸める
      const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
      const residual = rawStep / mag;
      const niceStep = residual <= 1.5 ? 1 * mag : residual <= 3.5 ? 2 * mag : 5 * mag;
      const minUnit = toUnit(cMin);
      const maxUnit = toUnit(cMax);
      const niceStart = Math.ceil(minUnit / niceStep) * niceStep;
      const tickvals: number[] = [];
      const ticktext: string[] = [];
      // niceStepに基づいて小数桁数を決定
      const decimals = niceStep >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(niceStep)));
      // µm は小さい値も読めるよう3桁、未校正の px は刻みに必要な桁だけ
      const fmt = valueCalibrated ? Math.max(decimals, 3) : decimals;
      for (let v = niceStart; v <= maxUnit + niceStep * 0.01; v += niceStep) {
        // µm値（colorDataがµm単位のため直接使用）
        const umVal = useMillimeter ? v * 1000 : v;
        tickvals.push(umVal);
        ticktext.push(v.toFixed(fmt));
      }
      // 最大tickにのみ単位を付与
      if (ticktext.length > 0) {
        ticktext[ticktext.length - 1] = `${ticktext[ticktext.length - 1]} ${unitLabel}`;
      }
      if (byConfidence) {
        tickvals.splice(0, tickvals.length, 0, 0.25, 0.5, 0.75, 1);
        ticktext.splice(0, ticktext.length, "0", "0.25", "0.5", "0.75", "1 信頼度");
      }

      data = [
        {
          type: "scatter3d",
          mode: "markers",
          x: xDataUm,
          y: yDataUm,
          z: zDataUm,
          marker: {
            size: viewMode === "2D-camera" ? 1.5 : 1,
            opacity: viewMode === "2D-camera" ? 0.15 : 0.08,
            color: colorData,
            colorscale: pointColor.colorscale,
            cmin: pointColor.cmin,
            cmax: pointColor.cmax,
            showscale: true,
            colorbar: {
              x: colorbarPosRef.current.x,
              xanchor: "right",
              y: colorbarPosRef.current.y,
              yanchor: "bottom",
              len: 0.34,
              thickness: 8,
              outlinewidth: 0,
              ypad: 0,
              tickfont: { color: colors.textMuted, family: monoFont, size: 10.5 },
              tickvals,
              ticktext,
            },
          },
        },
      ];

      // 描画種別の切替(surface⇄points)ではカメラ規約が異なるため、保存カメラを破棄
      if (plotKindRef.current !== "points") savedCameraRef.current = null;

      layout = {
        title: "",
        autosize: true,
        margin: { l: 0, r: 0, t: 30, b: 0 },
        paper_bgcolor: "rgba(0,0,0,0)",
        scene: {
          bgcolor: "rgba(0,0,0,0)",
          xaxis: {
            title: axisVisible
              ? {
                  text: dataSource === "device" ? "Z [µm]" : heightLabel(dataSource, scale),
                  font: { size: 12, color: colors.textMuted },
                }
              : "",
            visible: viewMode === "3D" && axisVisible,
            showgrid: viewMode === "3D" && axisVisible,
            zeroline: viewMode === "3D" && axisVisible,
            color: colors.textMuted,
            gridcolor: colors.grid,
          },
          yaxis: {
            title: axisVisible
              ? { text: "X [µm]", font: { size: 12, color: colors.textMuted } }
              : "",
            visible: axisVisible,
            showgrid: axisVisible,
            zeroline: axisVisible,
            color: colors.textMuted,
            gridcolor: colors.grid,
          },
          zaxis: {
            title: axisVisible
              ? {
                  text: hasSweep ? "Y [µm]" : "Y (仮定値)",
                  font: { size: 12, color: colors.textMuted },
                }
              : "",
            visible: axisVisible,
            showgrid: axisVisible,
            zeroline: axisVisible,
            color: colors.textMuted,
            gridcolor: colors.grid,
          },
          aspectmode: "manual",
          aspectratio: (() => {
            const yRange = yUmMax - yUmMin || 1;
            const zRange = zUmMax - zUmMin || 1;
            if (viewMode === "2D-camera") {
              const yzMax = Math.max(yRange, zRange);
              return { x: 0.01, y: (yRange / yzMax) * 1.2, z: (zRange / yzMax) * 1.2 };
            }
            // X/Yは表示上の長さを揃え、Zは実寸比で調整
            const xRange = xUmMax - xUmMin || 1;
            const xyMax = Math.max(xRange, yRange);
            // 奥行き(x)は強調倍率を掛ける（データ値は変えず、表示上の長さだけ伸ばす）
            return {
              x: depthExaggeration,
              y: 1,
              z: Math.max(zRange / xyMax, 0.15),
            };
          })(),
          camera: savedCameraRef.current || cam,
          // viewMode が同じ間は react 後もカメラ操作を保持し、切替時のみ cam にリセット
          uirevision: viewMode,
          annotations: measureSceneAnnotations,
          // 2D-cameraではドラッグ回転を無効化
          ...(viewMode === "2D-camera" ? { dragmode: "pan" } : {}),
        },
      };
    }

    // 2Dモード + 断層表示時、クリックで決めた始点・終点のライン
    // X座標を点群の最大値より手前（カメラ側）に配置して常に前面に表示
    if (viewMode === "2D-camera" && showSlice && cloud) {
      const frontX = xUmMax + (xUmMax - xUmMin) * 0.01;
      pushSliceOverlay(data, (ys, zs) => ({ x: ys.map(() => frontX), y: ys, z: zs }));
    }

    // 距離計測マーカー
    if (measureMode && measurePt1) {
      const ms = measureStateRef.current;
      data.push({
        type: "scatter3d",
        mode: ms.pt2 ? "markers+lines" : "markers",
        x: ms.pt2 ? [measurePt1.x, ms.pt2.x] : [measurePt1.x],
        y: ms.pt2 ? [measurePt1.y, ms.pt2.y] : [measurePt1.y],
        z: ms.pt2 ? [measurePt1.z, ms.pt2.z] : [measurePt1.z],
        marker: { size: 3, color: "#ffffff", symbol: "diamond" },
        line: { color: "#ffffff", width: 4, dash: "dash" },
        showlegend: false,
        hoverinfo: "skip",
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = {
      responsive: true,
      displaylogo: false,
      displayModeBar: false,
      // カラーバーはドラッグで好きな位置へ動かせる
      edits: { colorbarPosition: true },
    };

    // クリックのヒットテスト鮮度が必要な間（断層の点選択・距離計測）は、surface と
    // 同様に purge+newPlot で作り直す。react 差分更新では gl3d のピッキングが更新されず、
    // 2点目のクリックが1点目と同じ座標を返す（線長0になり断層グラフが出ない）ため。
    const needsFreshHitTest = measureMode || (viewMode === "2D-camera" && showSlice);

    // 点群(scatter3d, 最大12万点)は WebGL 再構築コストが大きいため、同種なら react 差分更新。
    if (plotKindRef.current === "points" && !needsFreshHitTest) {
      markGlCamApplying();
      Plotly.react(plotEl, data, layout, config);
    } else {
      markGlCamApplying();
      Plotly.purge(plotEl);
      Plotly.newPlot(plotEl, data, layout, config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (plotEl as any).on("plotly_restyle", rememberColorbarPos);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (plotEl as any).on("plotly_click", (eventData: any) => {
        if (!eventData.points || eventData.points.length === 0) return;
        const p = eventData.points[0];

        // 距離計測モード
        if (measureStateRef.current.mode) {
          const s = measureStateRef.current;
          if (s.pt1 && s.pt2) return;
          // ハンドラ多重化(HMR等)やクリック二重発火でも1クリック=1点になるよう、
          // surface側と同じく短時間ロックで二重登録を防ぐ。
          // 高さの無い点（欠損のセル）は距離にできないので無視する（以前は表示で落ちていた）
          if (![p.x, p.y, p.z].every((v) => typeof v === "number" && isFinite(v))) return;
          if (measureLockRef.current) return;
          measureLockRef.current = true;
          const pt3 = { x: p.x as number, y: p.y as number, z: p.z as number };
          if (!s.pt1) {
            measureStateRef.current = { ...s, pt1: pt3 };
            setMeasurePt1(pt3);
          } else {
            measureStateRef.current = { ...s, pt2: pt3 };
            setMeasurePt2(pt3);
          }
          setTimeout(() => {
            measureLockRef.current = false;
          }, 300);
          return;
        }

        // 断層の点はここでは打たない（下の hover＋ネイティブの click で打つ）
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (plotEl as any).on("plotly_hover", (e: any) => {
        const p = e?.points?.[0];
        if (p) lastHoverRef.current = { y: p.y as number, z: p.z as number };
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (plotEl as any).on("plotly_unhover", () => {
        lastHoverRef.current = null;
      });
      // ユーザーのズーム/パン(カメラ操作)を保存し、後続の再描画で維持する。
      // シーン再構築中に Plotly 自身が発火させる relayout は保存しない
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (plotEl as any).on("plotly_relayout", (e: any) => {
        if (glCamApplyingRef.current) return;
        const c = e?.["scene.camera"];
        if (c) savedCameraRef.current = c;
      });
      plotKindRef.current = "points";
    }

    // 再描画ごとの purge はしない（react 再利用のため。破棄はアンマウント時のみ）
    return;
  }, [
    showPlot,
    axisVisible,
    renderPointsWithThree,
    renderSurfaceWithThree,
    depthExaggeration,
    pointColorBy,
    cloud,
    flipX,
    viewMode,
    showSlice,
    dataSource,
    scale,
    flipRef,
    colorRangeMin,
    colorRangeMax,
    plotType,
    zData,
    filledMask,
    pointGeom,
    measureMode,
    measurePt1,
    measurePt2,
    dimensionMode,
    dimLineVersion,
    // 以下は安定参照（App の useRef / useState 由来）。挙動には影響しないが
    // exhaustive-deps を満たすため明示する。
    plotRef,
    measureStateRef,
    dimLinesRef,
    dimIdRef,
    dimRangeRef,
    shiftHeldRef,
    setDimReadouts,
    setMeasurePt1,
    setMeasurePt2,
    setSliceLineStart,
    setSliceLineEnd,
  ]);

  // 断面線・帯の外形の変更は、重ね描きの2本だけ restyle で書き換える（面・点群は作り直さない）
  useEffect(() => {
    const el = plotRef.current;
    const o = sliceOverlayRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!el || !o || !(el as any).data || (el as any).data.length <= o.idx[1]) return;
    const [line, outline] = sliceOverlayData(sliceLineStart, sliceLineEnd, sliceBandUm, o.map);
    markGlCamApplying();
    Plotly.restyle(
      el,
      { x: [line.x, outline.x], y: [line.y, outline.y], z: [line.z, outline.z] },
      o.idx
    );
  }, [sliceLineStart, sliceLineEnd, sliceBandUm, plotRef]);
}

type SlicePt = { y: number; z: number } | null;

// 断面線（始点だけなら点1つ）と帯の外形を、シーン座標に変換して返す（無いものは空の配列）
function sliceOverlayData(
  start: SlicePt,
  end: SlicePt,
  bandUm: number,
  map: (ys: number[], zs: number[]) => { x: number[]; y: number[]; z: number[] }
) {
  const pts = [start, end].filter((p): p is { y: number; z: number } => p != null);
  const line = map(
    pts.map((p) => p.y),
    pts.map((p) => p.z)
  );
  const o =
    start && end && bandUm > 0 ? bandOutline(start, end, bandUm) : { y: [] as number[], z: [] };
  return [line, map(o.y, o.z)] as const;
}
