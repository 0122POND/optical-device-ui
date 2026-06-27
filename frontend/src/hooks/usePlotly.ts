import { useEffect, useMemo, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import Plotly from "plotly.js-dist-min";
import { DIM_COLORS } from "../utils/constants";
import type { PointCloud } from "../utils/pointCloud";
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
  cloud: PointCloud | null;
  flipX: boolean;
  viewMode: ViewMode;
  showSlice: boolean;
  sliceLineStart: { y: number; z: number } | null;
  sliceLineEnd: { y: number; z: number } | null;
  sweepInterval: string;
  sweepIntervalUnit: "um" | "mm";
  umPerPixelX: number;
  umPerPixelY: number;
  plotType: PlotType;
  zData: (number | null)[][] | null;
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
    cloud,
    flipX,
    viewMode,
    showSlice,
    sliceLineStart,
    sliceLineEnd,
    sweepInterval,
    sweepIntervalUnit,
    umPerPixelX,
    umPerPixelY,
    plotType,
    zData,
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
  const plotKindRef = useRef<"dim" | "surface" | "points" | null>(null);
  const dimRafRef = useRef<number | null>(null);
  const dimApplyingRef = useRef(false);

  // クリックハンドラ内で参照する状態を毎レンダーで最新化（Plotly.react でハンドラを
  // 貼り直さないため）。カメラ位置は layout.scene.uirevision により Plotly 側で保持される。
  useEffect(() => {
    viewModeRef.current = viewMode;
    showSliceRef.current = showSlice;
    sliceLineStartRef.current = sliceLineStart;
    sliceLineEndRef.current = sliceLineEnd;
  });

  // アンマウント時にプロットを破棄（再描画ごとの purge はしない＝react で再利用するため）
  // plotRef は安定参照のため実質マウント時1回のみ実行される。
  useEffect(() => {
    const el = plotRef.current;
    return () => {
      if (dimRafRef.current != null) cancelAnimationFrame(dimRafRef.current);
      if (el) Plotly.purge(el);
    };
  }, [plotRef]);

  // 点群(scatter3d)の物理座標(µm)変換と範囲。最大12万点×3配列の生成は重いので memo 化し、
  // 入力(cloud/反転/換算係数)が変わらない限り同じ配列参照を返す。これにより描画 effect が
  // 軸表示・計測マーカー等の無関係な state で再実行されても、Plotly.react は点群トレースを
  // 「変化なし」と判定して WebGL バッファの再アップロードを省略できる。
  const pointGeom = useMemo(() => {
    if (!cloud || cloud.x.length === 0) return null;
    // 左右反転時はX座標を反転
    const xData = flipX
      ? (() => {
          const maxX = cloud.x.reduce((a, b) => (a > b ? a : b), cloud.x[0]);
          return cloud.x.map((v) => maxX - v);
        })()
      : cloud.x;
    // Z軸の換算係数: 掃引間隔 → µm/スライス (未入力時は umPerPixelY を仮定)
    const sweepVal = parseFloat(sweepInterval);
    const hasSweep = !isNaN(sweepVal) && sweepVal > 0;
    const zUmPerSlice = hasSweep
      ? sweepIntervalUnit === "mm"
        ? sweepVal * 1000
        : sweepVal
      : umPerPixelY;
    // 物理単位（µm）に変換
    const xDataUm = xData.map((v) => v * umPerPixelX);
    const yDataUm = cloud.y.map((v) => v * umPerPixelY);
    const zDataUm = cloud.z.map((v) => v * zUmPerSlice);
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
  }, [cloud, flipX, umPerPixelX, umPerPixelY, sweepInterval, sweepIntervalUnit]);

  useEffect(() => {
    const plotEl = plotRef.current;
    if (!plotEl) return;

    if (!showPlot) {
      Plotly.purge(plotEl);
      plotKindRef.current = null;
      return;
    }

    // ---- 寸法測定モード（2D 本物のヒートマップ + ドラッグ可能な両矢印）----
    // 3Dシーンには編集可能図形が無いため、寸法測定中だけ真の2Dヒートマップで描画する。
    if (viewMode === "2D-camera" && dimensionMode && zData && zData.length > 0) {
      const numRows = zData.length;
      const numCols = zData[0].length;

      const sweepVal = parseFloat(sweepInterval);
      const hasSweep = !isNaN(sweepVal) && sweepVal > 0;
      const zUmPerSlice = hasSweep
        ? sweepIntervalUnit === "mm"
          ? sweepVal * 1000
          : sweepVal
        : umPerPixelY;

      const isOpticalDevice = cloud !== null && cloud.x.length > 0;

      let surfXCoords: number[];
      let surfYCoords: number[];
      let surfaceZ: (number | null)[][];
      let xLabel: string;
      let yLabel: string;
      let zLabel: string;
      let planeUnit: string;

      if (isOpticalDevice) {
        surfXCoords = Array.from({ length: numCols }, (_, i) => i * umPerPixelY);
        surfYCoords = Array.from({ length: numRows }, (_, i) => i * zUmPerSlice);
        if (flipX) {
          let maxRawX = -Infinity;
          for (const row of zData) {
            for (const v of row) {
              if (v != null && v > maxRawX) maxRawX = v;
            }
          }
          surfaceZ = zData.map((row) =>
            row.map((v) => (v == null ? null : (maxRawX - v) * umPerPixelX))
          );
        } else {
          surfaceZ = zData.map((row) => row.map((v) => (v == null ? null : v * umPerPixelX)));
        }
        xLabel = "X [µm]";
        yLabel = "Y [µm]";
        zLabel = "Z (Depth) [µm]";
        planeUnit = "µm";
      } else {
        surfXCoords = flipX
          ? Array.from({ length: numCols }, (_, i) => numCols - 1 - i)
          : Array.from({ length: numCols }, (_, i) => i);
        surfYCoords = Array.from({ length: numRows }, (_, i) => i);
        surfaceZ = zData.map((row) => row.map((v) => (v == null ? null : v)));
        xLabel = "X [pixel]";
        yLabel = "Y [pixel]";
        zLabel = "Height [µm]";
        planeUnit = "px";
      }

      let hMin = Infinity,
        hMax = -Infinity;
      for (const row of surfaceZ) {
        for (const v of row) {
          if (v == null) continue;
          if (v < hMin) hMin = v;
          if (v > hMax) hMax = v;
        }
      }
      if (!isFinite(hMin)) {
        hMin = 0;
        hMax = 1;
      }

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
          colorscale: [
            [0, "#0000ff"],
            [0.25, "#00bfff"],
            [0.5, "#00ff00"],
            [0.75, "#ffbf00"],
            [1, "#ff0000"],
          ],
          zmin: hMin,
          zmax: hMax,
          zsmooth: false,
          connectgaps: false,
          colorbar: {
            x: -0.05,
            thickness: 18,
            len: 0.9,
            ypad: 10,
            tickfont: { color: "#ffffff" },
            title: { text: zLabel, font: { color: "#ffffff", size: 11 }, side: "right" },
          },
          hovertemplate: `${xLabel}: %{x:.1f}<br>${yLabel}: %{y:.1f}<br>${zLabel}: %{z:.2f}<extra></extra>`,
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dimLayout: any = {
        autosize: true,
        margin: { l: 50, r: 10, t: 30, b: 45 },
        paper_bgcolor: "#000000",
        plot_bgcolor: "#000000",
        dragmode: "pan",
        xaxis: {
          title: { text: xLabel, font: { size: 12, color: "#ffffff" } },
          color: "#ffffff",
          gridcolor: "#222222",
          zeroline: false,
          constrain: "domain",
        },
        yaxis: {
          title: { text: yLabel, font: { size: 12, color: "#ffffff" } },
          color: "#ffffff",
          gridcolor: "#222222",
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
        edits: { shapePosition: true, annotationPosition: true },
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
      const numRows = zData.length;
      const numCols = zData[0].length;

      // 掃引間隔（µm/スライス）
      const sweepVal = parseFloat(sweepInterval);
      const hasSweep = !isNaN(sweepVal) && sweepVal > 0;
      const zUmPerSlice = hasSweep
        ? sweepIntervalUnit === "mm"
          ? sweepVal * 1000
          : sweepVal
        : umPerPixelY;

      // データソース判定: 値がピクセル座標っぽい（小さい値）なら光学デバイス、大きい値ならCSV（Keyence等）
      // 光学デバイスのgrid値はX重心(0〜画像幅≒1000px)、KeyenceのCSV値は高さ(µm、数百〜)
      // cloud が存在する場合は光学デバイス由来と判断
      const isOpticalDevice = cloud !== null && cloud.x.length > 0;

      // 座標配列とsurface Z値を生成（µm単位に変換）
      let surfXCoords: number[];
      let surfYCoords: number[];
      let surfaceZ: (number | null)[][];
      let xLabel: string;
      let yLabel: string;
      let zLabel: string;

      if (isOpticalDevice) {
        // 光学デバイス: 列=Y方向ピクセル→µm, 行=Zスライス→µm, 値=X重心→µm
        surfXCoords = Array.from({ length: numCols }, (_, i) => i * umPerPixelY);
        surfYCoords = Array.from({ length: numRows }, (_, i) => i * zUmPerSlice);
        if (flipX) {
          // 左右反転: X重心を反転してからµm変換
          let maxRawX = -Infinity;
          for (const row of zData) {
            for (const v of row) {
              if (v != null && v > maxRawX) maxRawX = v;
            }
          }
          surfaceZ = zData.map((row) =>
            row.map((v) => (v == null ? null : (maxRawX - v) * umPerPixelX))
          );
        } else {
          surfaceZ = zData.map((row) => row.map((v) => (v == null ? null : v * umPerPixelX)));
        }
        xLabel = "X [µm]";
        yLabel = "Y [µm]";
        zLabel = "Z (Depth) [µm]";
      } else {
        // CSV読み込み（Keyence等）: 左右反転時はX座標を逆順に
        surfXCoords = flipX
          ? Array.from({ length: numCols }, (_, i) => numCols - 1 - i)
          : Array.from({ length: numCols }, (_, i) => i);
        surfYCoords = Array.from({ length: numRows }, (_, i) => i);
        surfaceZ = zData.map((row) => row.map((v) => (v == null ? null : v)));
        xLabel = "X [pixel]";
        yLabel = "Y [pixel]";
        zLabel = "Height [µm]";
      }

      // 高さ範囲を計算（変換後の値から）
      let hMin = Infinity,
        hMax = -Infinity;
      for (const row of surfaceZ) {
        for (const v of row) {
          if (v == null) continue;
          if (v < hMin) hMin = v;
          if (v > hMax) hMax = v;
        }
      }

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
          colorscale: [
            [0, "#0000ff"],
            [0.25, "#00bfff"],
            [0.5, "#00ff00"],
            [0.75, "#ffbf00"],
            [1, "#ff0000"],
          ],
          cmin: hMin,
          cmax: hMax,
          showscale: true,
          colorbar: {
            x: -0.05,
            thickness: 18,
            len: 0.9,
            ypad: 10,
            tickfont: { color: "#ffffff" },
            title: { text: zLabel, font: { color: "#ffffff", size: 11 }, side: "right" },
          },
          contours: {
            z: { show: false },
          },
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const surfLayout: any = {
        title: "",
        autosize: true,
        margin: { l: 0, r: 0, t: 30, b: 0 },
        paper_bgcolor: "#000000",
        scene: {
          bgcolor: "#000000",
          xaxis: {
            title: axisVisible ? { text: xLabel, font: { size: 12, color: "#ffffff" } } : "",
            visible: viewMode === "3D" && axisVisible,
            showgrid: viewMode === "3D" && axisVisible,
            zeroline: viewMode === "3D" && axisVisible,
            color: "#ffffff",
            gridcolor: "#333333",
          },
          yaxis: {
            title: axisVisible ? { text: yLabel, font: { size: 12, color: "#ffffff" } } : "",
            visible: axisVisible,
            showgrid: axisVisible,
            zeroline: axisVisible,
            color: "#ffffff",
            gridcolor: "#333333",
          },
          zaxis: {
            title: axisVisible ? { text: zLabel, font: { size: 12, color: "#ffffff" } } : "",
            visible: axisVisible,
            showgrid: axisVisible,
            zeroline: axisVisible,
            color: "#ffffff",
            gridcolor: "#333333",
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
          camera: cam,
          // viewMode が同じ間は react 後もカメラ操作を保持し、切替時のみ cam にリセット
          uirevision: viewMode,
          ...(viewMode === "2D-camera" ? { dragmode: "pan" } : {}),
        },
      };

      // 2Dモード + 断層表示時、クリックで決めた始点・終点のラインを描画
      if (viewMode === "2D-camera" && showSlice) {
        const frontZ = hMax + hRange * 0.05;

        if (sliceLineStart && sliceLineEnd) {
          surfData.push({
            type: "scatter3d",
            mode: "lines+markers",
            x: [sliceLineStart.y, sliceLineEnd.y],
            y: [sliceLineStart.z, sliceLineEnd.z],
            z: [frontZ, frontZ],
            line: { color: "#ff4444", width: 3 },
            marker: { size: 4, color: "#ff4444" },
            showlegend: false,
            hoverinfo: "skip",
          });
        } else if (sliceLineStart) {
          surfData.push({
            type: "scatter3d",
            mode: "markers",
            x: [sliceLineStart.y],
            y: [sliceLineStart.z],
            z: [frontZ],
            marker: { size: 6, color: "#ff4444" },
            showlegend: false,
            hoverinfo: "skip",
          });
        }
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
      const config: any = { responsive: true, displaylogo: false, displayModeBar: false };
      // 同種(surface)で再描画する場合は react で差分更新（WebGL再構築を避け凍結を防ぐ）。
      // 種別が変わる時だけ purge + newPlot し、クリックハンドラを貼り直す。
      if (plotKindRef.current === "surface") {
        Plotly.react(plotEl, surfData, surfLayout, config);
      } else {
        Plotly.purge(plotEl);
        Plotly.newPlot(plotEl, surfData, surfLayout, config);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (plotEl as any).on("plotly_click", (eventData: any) => {
          if (!eventData.points || eventData.points.length === 0) return;
          const p = eventData.points[0];

          // 距離計測モード
          if (measureStateRef.current.mode) {
            const s = measureStateRef.current;
            if (s.pt1 && s.pt2) return;
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

          // 2Dモード + 断層表示時、クリックで始点・終点を設定（最新値は ref から読む）
          if (viewModeRef.current === "2D-camera" && showSliceRef.current) {
            const pt = { y: p.x as number, z: p.y as number };
            if (
              !sliceLineStartRef.current ||
              (sliceLineStartRef.current && sliceLineEndRef.current)
            ) {
              setSliceLineStart(pt);
              setSliceLineEnd(null);
            } else {
              setSliceLineEnd(pt);
            }
          }
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

    // 掃引間隔が指定されているか（Z軸ラベルの表示分岐に使用）
    const sweepVal = parseFloat(sweepInterval);
    const hasSweep = !isNaN(sweepVal) && sweepVal > 0;

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

      // カラーバーのカスタムtick（最大値のみ単位表示、colorDataはµm単位）
      const colorData = xDataUm;
      const cMin = xUmMin;
      const cMax = xUmMax;
      // mm超えたらmm表示
      const useMillimeter = cMax >= 1000;
      const unitLabel = useMillimeter ? "mm" : "µm";
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
      const fmt = Math.max(decimals, 3);
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
            colorscale: [
              [0, "#0000ff"],
              [0.25, "#00bfff"],
              [0.5, "#00ff00"],
              [0.75, "#ffbf00"],
              [1, "#ff0000"],
            ],
            showscale: true,
            colorbar: {
              x: -0.05,
              thickness: 18,
              len: 0.9,
              ypad: 10,
              tickfont: { color: "#ffffff" },
              tickvals,
              ticktext,
            },
          },
        },
      ];

      layout = {
        title: "",
        autosize: true,
        margin: { l: 0, r: 0, t: 30, b: 0 },
        paper_bgcolor: "#000000",
        scene: {
          bgcolor: "#000000",
          xaxis: {
            title: axisVisible ? { text: "Z [µm]", font: { size: 12, color: "#ffffff" } } : "",
            visible: viewMode === "3D" && axisVisible,
            showgrid: viewMode === "3D" && axisVisible,
            zeroline: viewMode === "3D" && axisVisible,
            color: "#ffffff",
            gridcolor: "#333333",
          },
          yaxis: {
            title: axisVisible ? { text: "X [µm]", font: { size: 12, color: "#ffffff" } } : "",
            visible: axisVisible,
            showgrid: axisVisible,
            zeroline: axisVisible,
            color: "#ffffff",
            gridcolor: "#333333",
          },
          zaxis: {
            title: axisVisible
              ? {
                  text: hasSweep ? "Y [µm]" : "Y (仮定値)",
                  font: { size: 12, color: "#ffffff" },
                }
              : "",
            visible: axisVisible,
            showgrid: axisVisible,
            zeroline: axisVisible,
            color: "#ffffff",
            gridcolor: "#333333",
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
            return {
              x: 1,
              y: 1,
              z: Math.max(zRange / xyMax, 0.15),
            };
          })(),
          camera: cam,
          // viewMode が同じ間は react 後もカメラ操作を保持し、切替時のみ cam にリセット
          uirevision: viewMode,
          // 2D-cameraではドラッグ回転を無効化
          ...(viewMode === "2D-camera" ? { dragmode: "pan" } : {}),
        },
      };
    }

    // 2Dモード + 断層表示時、クリックで決めた始点・終点のラインを描画
    // X座標を点群の最大値より手前（カメラ側）に配置して常に前面に表示
    if (viewMode === "2D-camera" && showSlice && cloud) {
      const frontX = xUmMax + (xUmMax - xUmMin) * 0.01;

      if (sliceLineStart && sliceLineEnd) {
        data.push({
          type: "scatter3d",
          mode: "lines+markers",
          x: [frontX, frontX],
          y: [sliceLineStart.y, sliceLineEnd.y],
          z: [sliceLineStart.z, sliceLineEnd.z],
          line: { color: "#ff4444", width: 3 },
          marker: { size: 4, color: "#ff4444" },
          showlegend: false,
          hoverinfo: "skip",
        });
      } else if (sliceLineStart) {
        data.push({
          type: "scatter3d",
          mode: "markers",
          x: [frontX],
          y: [sliceLineStart.y],
          z: [sliceLineStart.z],
          marker: { size: 6, color: "#ff4444" },
          showlegend: false,
          hoverinfo: "skip",
        });
      }
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
    const config: any = { responsive: true, displaylogo: false, displayModeBar: false };

    // 点群(scatter3d, 最大12万点)は WebGL 再構築コストが大きいため、同種なら react 差分更新。
    if (plotKindRef.current === "points") {
      Plotly.react(plotEl, data, layout, config);
    } else {
      Plotly.purge(plotEl);
      Plotly.newPlot(plotEl, data, layout, config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (plotEl as any).on("plotly_click", (eventData: any) => {
        if (!eventData.points || eventData.points.length === 0) return;
        const p = eventData.points[0];

        // 距離計測モード
        if (measureStateRef.current.mode) {
          const s = measureStateRef.current;
          if (s.pt1 && s.pt2) return;
          const pt3 = { x: p.x as number, y: p.y as number, z: p.z as number };
          if (!s.pt1) {
            measureStateRef.current = { ...s, pt1: pt3 };
            setMeasurePt1(pt3);
          } else {
            measureStateRef.current = { ...s, pt2: pt3 };
            setMeasurePt2(pt3);
          }
          return;
        }

        // 2Dモード + 断層表示時、クリックで始点・終点を設定（最新値は ref から読む）
        if (viewModeRef.current === "2D-camera" && showSliceRef.current) {
          const pt = { y: p.y as number, z: p.z as number };
          if (
            !sliceLineStartRef.current ||
            (sliceLineStartRef.current && sliceLineEndRef.current)
          ) {
            setSliceLineStart(pt);
            setSliceLineEnd(null);
          } else {
            setSliceLineEnd(pt);
          }
        }
      });
      plotKindRef.current = "points";
    }

    // 再描画ごとの purge はしない（react 再利用のため。破棄はアンマウント時のみ）
    return;
  }, [
    showPlot,
    axisVisible,
    cloud,
    flipX,
    viewMode,
    showSlice,
    sliceLineStart,
    sliceLineEnd,
    sweepInterval,
    sweepIntervalUnit,
    umPerPixelX,
    umPerPixelY,
    plotType,
    zData,
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
}
