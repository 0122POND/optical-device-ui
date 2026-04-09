import { useEffect, useRef, useState, useCallback } from "react";
import Plotly from "plotly.js-dist-min";
import { generateCoinData, addNoise } from "./utils/surface";
import { downloadCSV, parseCSV } from "./utils/csv";
import { buildPointCloudFromFolder, type PointCloud } from "./utils/pointCloud";
import "./App.css";

const WS_URL = `ws://${window.location.hostname}:8000/ws`;

// 1ピクセルあたりのµm換算係数（軸ごとに異なる）
const UM_PER_PIXEL_X = 1.8; // 干渉画像の横方向（深さ方向）
const UM_PER_PIXEL_Y = 20; // 干渉画像の縦方向

// カラーパレット（モダングレー）
const colors = {
  bg: "#3a3f47",
  bgLight: "#454b54",
  bgDark: "#2d3139",
  border: "#4f5661",
  borderLight: "#5a6270",
  text: "#f0f1f3",
  textMuted: "#9ca3af",
  textDim: "#8b939f",
  primary: "#3b82f6",
  primaryHover: "#2563eb",
  danger: "#ef4444",
  success: "#22c55e",
  secondary: "#6b7280",
  secondaryHover: "#4b5563",
};

// フォント設定
const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// 計測ステータス
type MeasureStatus = "READY" | "RUNNING" | "COMPLETE";

const StatusBadge = ({ status }: { status: MeasureStatus }) => {
  const config = {
    READY: {
      bg: "#1e3a2f",
      color: "#6bff95",
      border: "#6bff9555",
      dot: "#3ddc84",
      label: "READY",
    },
    RUNNING: {
      bg: "#3a2828",
      color: "#ff6b6b",
      border: "#ff6b6b55",
      dot: "#ff4d4d",
      label: "RUNNING",
    },
    COMPLETE: {
      bg: "#1e2a3a",
      color: "#6b95ff",
      border: "#6b95ff55",
      dot: "#4d7fff",
      label: "COMPLETE",
    },
  };
  const c = config[status];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "8px 12px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 600,
        backgroundColor: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
      }}
    >
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: c.dot,
          animation: status === "RUNNING" ? "blink 1s ease-in-out infinite" : "none",
        }}
      />
      {c.label}
    </div>
  );
};

function App() {
  const GRID_SIZE = 80;
  const plotRef = useRef<HTMLDivElement | null>(null);
  const sliceRef = useRef<HTMLDivElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraRef = useRef<any>(null);

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null);

  // 表示モード
  type ViewMode = "3D" | "2D-camera";
  const [viewMode, setViewMode] = useState<ViewMode>("3D");

  // 軸表示フラグ（true = 表示 / false = 非表示）
  const [axisVisible, setAxisVisible] = useState(true);

  // 左右反転フラグ（true = 反転 / false = 通常）
  const [flipX, setFlipX] = useState(false);
  // Z軸反転フラグ（true = 反転 / false = 通常）
  const [flipZ] = useState(false);
  // Y軸反転フラグ（true = 反転 / false = 通常）- 文字鏡像の補正用
  const [flipY, setFlipY] = useState(false);

  // 確認ダイアログの表示フラグ
  const [showConfirm, setShowConfirm] = useState(false);

  // 確認ダイアログの種類（3D開始 or CSV出力 or 終了）
  const [confirmMode, setConfirmMode] = useState<"plot" | "csv" | "ai" | null>(null);

  // GPU使用フラグ（STARTボタンで選択）
  const [useGpu, setUseGpu] = useState(false);
  const [algorithm, setAlgorithm] = useState<
    "coin" | "coin2" | "tgv" | "elec" | "medical" | "semi"
  >("coin");

  // 3Dグラフを表示するかどうか
  const [showPlot, setShowPlot] = useState(false);

  // 断層グラフを表示するかどうか
  const [showSlice, setShowSlice] = useState(false);

  // 断層ライン始点・終点（2クリックで決定）
  const [sliceLineStart, setSliceLineStart] = useState<{ y: number; z: number } | null>(null);
  const [sliceLineEnd, setSliceLineEnd] = useState<{ y: number; z: number } | null>(null);

  // 距離計測
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePt1, setMeasurePt1] = useState<{ x: number; y: number; z: number } | null>(null);
  const [measurePt2, setMeasurePt2] = useState<{ x: number; y: number; z: number } | null>(null);
  type MeasurePt = { x: number; y: number; z: number } | null;
  const measureStateRef = useRef<{ mode: boolean; pt1: MeasurePt; pt2: MeasurePt }>({
    mode: false,
    pt1: null,
    pt2: null,
  });
  const measureLockRef = useRef(false);

  const [status, setStatus] = useState<MeasureStatus>("READY");

  // 掃引関連の入力値 & 単位
  const [sweepInterval, setSweepInterval] = useState("100");
  const [sweepIntervalUnit, setSweepIntervalUnit] = useState<"um" | "mm">("um");

  const [zData, setZData] = useState<(number | null)[][] | null>(null);
  const [cloud, setCloud] = useState<PointCloud | null>(null);

  // 表示タイプ（scatter3d: 点群 / surface: サーフェス）
  type PlotType = "scatter3d" | "surface";
  const [plotType, setPlotType] = useState<PlotType>("scatter3d");

  // 測定履歴（最大5件）
  type HistorySource = "coin" | "coin2" | "tgv" | "elec" | "medical" | "semi" | "csv" | "ai";
  type CloudHistoryEntry = {
    cloud: PointCloud;
    measuredAt: string;
    points: number;
    thumbnail: string;
    name: string;
    source: HistorySource;
  };
  const [cloudHistory, setCloudHistory] = useState<CloudHistoryEntry[]>([]);
  const [deleteConfirmIdx, setDeleteConfirmIdx] = useState<number | null>(null);
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");

  // 点群から2Dサムネイル（data URL）を生成
  const generateThumbnail = (pc: PointCloud, size = 64): string => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, size, size);

    const { y, z, x: depth } = pc;
    const n = y.length;
    if (n === 0) return canvas.toDataURL();

    // データ範囲を計算
    let yMin = y[0],
      yMax = y[0],
      zMin = z[0],
      zMax = z[0],
      dMin = depth[0],
      dMax = depth[0];
    for (let i = 1; i < n; i++) {
      if (y[i] < yMin) yMin = y[i];
      if (y[i] > yMax) yMax = y[i];
      if (z[i] < zMin) zMin = z[i];
      if (z[i] > zMax) zMax = z[i];
      if (depth[i] < dMin) dMin = depth[i];
      if (depth[i] > dMax) dMax = depth[i];
    }
    const yRange = yMax - yMin || 1;
    const zRange = zMax - zMin || 1;
    const dRange = dMax - dMin || 1;

    // アスペクト比を保ってfit（余白2px）
    const pad = 2;
    const drawSize = size - pad * 2;
    const scale = Math.min(drawSize / yRange, drawSize / zRange);
    const offY = (size - yRange * scale) / 2;
    const offZ = (size - zRange * scale) / 2;

    // カラースケール（青→水色→緑→黄→赤）
    const stops = [
      [0, 0, 255],
      [0, 191, 255],
      [0, 255, 0],
      [255, 191, 0],
      [255, 0, 0],
    ];
    const toColor = (t: number) => {
      const idx = t * (stops.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, stops.length - 1);
      const f = idx - lo;
      return `rgb(${stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f},${stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f},${stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f})`;
    };

    // 間引き描画（多すぎる場合）
    const step = n > 20000 ? Math.ceil(n / 20000) : 1;
    for (let i = 0; i < n; i += step) {
      const px = offY + (y[i] - yMin) * scale;
      const py = size - (offZ + (z[i] - zMin) * scale);
      const t = (depth[i] - dMin) / dRange;
      ctx.fillStyle = toColor(t);
      ctx.fillRect(px, py, 1.2, 1.2);
    }
    return canvas.toDataURL("image/png");
  };

  // 進捗表示用
  const [progressStep, setProgressStep] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);

  // 取得中フラグ
  const [isAcquiring, setIsAcquiring] = useState(false);

  // AI結果読み込み中フラグ
  const [isLoadingAI, setIsLoadingAI] = useState(false);

  // マスク読込中フラグ
  const [isLoadingMask, setIsLoadingMask] = useState(false);

  // サイドパネルのタブ
  type SideTab = "settings" | "actions" | "result";
  const [sideTab, setSideTab] = useState<SideTab>("actions");

  // ドラッグモード（pan / turntable / orbit）
  type DragMode = "pan" | "turntable" | "orbit";
  const [dragMode, setDragMode] = useState<DragMode>("turntable");

  // About Usポップアップ表示フラグ
  const [showAbout, setShowAbout] = useState(false);
  const [showAlgorithms, setShowAlgorithms] = useState(false);
  const aboutRef = useRef<HTMLDivElement>(null);

  // About Usポップアップ外クリックで閉じる
  useEffect(() => {
    if (!showAbout) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (aboutRef.current && !aboutRef.current.contains(e.target as Node)) {
        setShowAbout(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showAbout]);

  // 最終計測日時
  const [lastMeasuredAt, setLastMeasuredAt] = useState<string | null>(null);

  // 測定回数
  const [measureCount, setMeasureCount] = useState(0);

  // setTimeout のID保持（連打対策 & アンマウント対策）
  const acquireTimerRef = useRef<number | null>(null);

  const inputStyle: React.CSSProperties = {
    height: "44px",
    padding: "8px 12px",
    borderRadius: "6px",
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgDark,
    color: colors.text,
    fontSize: "13px",
    fontFamily: fontFamily,
    outline: "none",
    transition: "border-color 0.2s",
  };

  const unitSelectStyle: React.CSSProperties = {
    height: "44px",
    padding: "0 12px",
    borderRadius: "6px",
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgDark,
    color: colors.text,
    fontSize: "13px",
    fontFamily: fontFamily,
    cursor: "pointer",
    outline: "none",
  };

  const buttonPrimaryStyle: React.CSSProperties = {
    height: "44px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: colors.primary,
    color: colors.text,
    fontSize: "14px",
    fontWeight: 600,
    fontFamily: fontFamily,
    cursor: "pointer",
    transition: "background-color 0.2s, opacity 0.2s",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 12px",
    boxSizing: "border-box",
  };

  const buttonSecondaryStyle: React.CSSProperties = {
    height: "44px",
    borderRadius: "6px",
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgDark,
    color: colors.text,
    fontSize: "13px",
    fontWeight: 500,
    fontFamily: fontFamily,
    cursor: "pointer",
    transition: "background-color 0.2s",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "0 12px",
    boxSizing: "border-box",
  };

  // WebSocket接続
  const connectWebSocket = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return wsRef.current;
    }

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("WebSocket connected");
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("WS message:", data);

        if (data.type === "progress") {
          setProgressStep(data.step);
          setProgressTotal(data.total);
          setProgressMessage(data.message);
          setProgressPercent(data.percent);
        } else if (data.type === "ai_inference_complete") {
          console.log("AI推論完了:", data.count, "files", "device:", data.device);
          try {
            const { cloud: newCloud, grid: newGrid } = await buildPointCloudFromFolder({
              folderUrl: "/data/mask_result",
              threshold: 128,
              samplePerSlice: 4000,
              flipZ: flipZ,
              colorMode: "z",
              ...(algorithm === "tgv" ? { maxTotalPoints: 250_000 } : {}),
            });

            setCloud(newCloud);
            setZData(newGrid);
            setPlotType("scatter3d");
            setIsLoadingAI(false);
            setStatus("COMPLETE");
            setProgressMessage(`AI推論完了 (${data.device})`);
            setProgressPercent(100);
            const now = new Date().toLocaleString("ja-JP");
            setLastMeasuredAt(now);
            setMeasureCount((c) => c + 1);
            const thumb = generateThumbnail(newCloud);
            setCloudHistory((prev) =>
              [
                {
                  cloud: newCloud,
                  measuredAt: now,
                  points: newCloud.x.length,
                  thumbnail: thumb,
                  name: "",
                  source: "ai" as HistorySource,
                },
                ...prev,
              ].slice(0, 5)
            );
            console.log("AI点群生成完了", { points: newCloud.x.length });
          } catch (e) {
            console.error(e);
            setIsLoadingAI(false);
            setStatus("READY");
            setShowPlot(false);
            alert(`AI結果の点群生成に失敗しました: ${(e as Error).message}`);
          }
        } else if (data.type === "preprocess_complete") {
          console.log("画像処理完了:", data.count, "files");
          // 処理完了後、点群を読み込み
          try {
            const { cloud: newCloud, grid: newGrid } = await buildPointCloudFromFolder({
              folderUrl: "/data/result",
              threshold: 128,
              samplePerSlice: 4000,
              flipZ: flipZ,
              colorMode: "z",
              ...(algorithm === "tgv" ? { maxTotalPoints: 250_000 } : {}),
            });

            setCloud(newCloud);
            setZData(newGrid);
            setPlotType("scatter3d");
            setIsAcquiring(false);
            setStatus("COMPLETE");
            setProgressMessage("完了");
            setProgressPercent(100);
            const now = new Date().toLocaleString("ja-JP");
            setLastMeasuredAt(now);
            setMeasureCount((c) => c + 1);
            const thumb = generateThumbnail(newCloud);
            setCloudHistory((prev) =>
              [
                {
                  cloud: newCloud,
                  measuredAt: now,
                  points: newCloud.x.length,
                  thumbnail: thumb,
                  name: "",
                  source: algorithm,
                },
                ...prev,
              ].slice(0, 5)
            );
            console.log("点群生成完了", { points: newCloud.x.length });
          } catch (e) {
            console.error(e);
            setIsAcquiring(false);
            setStatus("READY");
            setShowPlot(false);
            alert(`点群生成に失敗しました: ${(e as Error).message}`);
          }
        } else if (data.type === "status") {
          if (data.value === "RUNNING") {
            setStatus("RUNNING");
          } else if (data.value === "COMPLETE") {
            // preprocess_completeで処理するので、ここでは何もしない
          } else if (data.value === "READY") {
            setStatus("READY");
          }
        } else if (data.type === "error") {
          console.error("Server error:", data.message);
          setIsAcquiring(false);
          setStatus("READY");
          alert(`エラー: ${data.message}`);
        }
      } catch (e) {
        console.error("Failed to parse WS message:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
      wsRef.current = null;
    };

    wsRef.current = ws;
    return ws;
  }, []);

  // コンポーネントマウント時にWebSocket接続
  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  useEffect(() => {
    const timerRef = acquireTimerRef;
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showPlot || !plotRef.current) return;
    const el = plotRef.current;

    // showSliceが変わるとコンテナサイズが変わるので、少し遅延してリサイズ
    const timer = setTimeout(() => {
      requestAnimationFrame(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Plotly.Plots.resize(el as any);
      });
    }, 50);

    return () => clearTimeout(timer);
  }, [showPlot, showSlice]);

  // 再描画前のカメラ状態を保存・復元するヘルパー

  const saveCameraState = (el: HTMLDivElement) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const curLayout = (el as any).layout;
      if (curLayout?.scene?.camera) {
        cameraRef.current = curLayout.scene.camera;
      }
    } catch {
      /* 初回描画時など */
    }
  };

  useEffect(() => {
    const plotEl = plotRef.current;
    if (!plotEl) return;

    if (!showPlot) {
      Plotly.purge(plotEl);
      return;
    }

    const savedCamera = cameraRef.current;

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
        : UM_PER_PIXEL_Y;

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
        surfXCoords = Array.from({ length: numCols }, (_, i) => i * UM_PER_PIXEL_Y);
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
            row.map((v) => (v == null ? null : (maxRawX - v) * UM_PER_PIXEL_X))
          );
        } else {
          surfaceZ = zData.map((row) => row.map((v) => (v == null ? null : v * UM_PER_PIXEL_X)));
        }
        // Y軸反転: 各行を逆順にして文字鏡像を補正
        if (flipY) {
          surfaceZ = surfaceZ.map((row) => [...row].reverse());
          surfXCoords = [...surfXCoords].reverse();
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
          camera: savedCamera || cam,
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

        // 2Dモード + 断層表示時、クリックで始点・終点を設定
        if (viewMode === "2D-camera" && showSlice) {
          const pt = { y: p.x as number, z: p.y as number };
          if (!sliceLineStart || (sliceLineStart && sliceLineEnd)) {
            setSliceLineStart(pt);
            setSliceLineEnd(null);
          } else {
            setSliceLineEnd(pt);
          }
        }
      });

      return () => {
        saveCameraState(plotEl);
        Plotly.purge(plotEl);
      };
    }

    if (!cloud) {
      Plotly.purge(plotEl);
      return;
    }

    // 左右反転時はX座標を反転
    const xData = flipX
      ? (() => {
          const maxX = cloud.x.reduce((a, b) => (a > b ? a : b), cloud.x[0]);
          return cloud.x.map((v) => maxX - v);
        })()
      : cloud.x;

    // Z軸の換算係数: 掃引間隔 → µm/スライス (未入力時は UM_PER_PIXEL_Y を仮定)
    const sweepVal = parseFloat(sweepInterval);
    const hasSweep = !isNaN(sweepVal) && sweepVal > 0;
    const zUmPerSlice = hasSweep
      ? sweepIntervalUnit === "mm"
        ? sweepVal * 1000
        : sweepVal
      : UM_PER_PIXEL_Y;

    // Y軸反転: Y座標を反転して文字鏡像を補正
    const yData = flipY
      ? (() => {
          const maxY = cloud.y.reduce((a, b) => (a > b ? a : b), cloud.y[0]);
          return cloud.y.map((v) => maxY - v);
        })()
      : cloud.y;

    // 物理単位（µm）に変換
    const xDataUm = xData.map((v) => v * UM_PER_PIXEL_X);
    const yDataUm = yData.map((v) => v * UM_PER_PIXEL_Y);
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
          camera: savedCamera || cam,
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

      // 2Dモード + 断層表示時、クリックで始点・終点を設定
      if (viewMode === "2D-camera" && showSlice) {
        const pt = { y: p.y as number, z: p.z as number };
        if (!sliceLineStart || (sliceLineStart && sliceLineEnd)) {
          setSliceLineStart(pt);
          setSliceLineEnd(null);
        } else {
          setSliceLineEnd(pt);
        }
      }
    });

    return () => {
      saveCameraState(plotEl);
      Plotly.purge(plotEl);
    };
  }, [
    showPlot,
    axisVisible,
    cloud,
    flipX,
    flipY,
    viewMode,
    showSlice,
    sliceLineStart,
    sliceLineEnd,
    sweepInterval,
    sweepIntervalUnit,
    plotType,
    zData,
    measureMode,
    measurePt1,
    measurePt2,
  ]);

  // --- 2D 断層グラフ描画 ---
  useEffect(() => {
    const sliceEl = sliceRef.current;
    if (!sliceEl) return;

    if (!showSlice || !sliceLineStart || !sliceLineEnd) {
      Plotly.purge(sliceEl);
      return;
    }

    // Z軸の換算係数: 掃引間隔 → µm/スライス (未入力時は UM_PER_PIXEL_Y を仮定)
    const sweepVal = parseFloat(sweepInterval);
    const hasSweep = !isNaN(sweepVal) && sweepVal > 0;
    const zUmPerSlice = hasSweep
      ? sweepIntervalUnit === "mm"
        ? sweepVal * 1000
        : sweepVal
      : UM_PER_PIXEL_Y;

    // flipX時の反転用: 3Dプロットと同じmaxRawXを使い深度値を反転
    const maxRawX = flipX && cloud ? cloud.x.reduce((a, b) => (a > b ? a : b), cloud.x[0]) : 0;
    // surfaceモードかつCSV由来: grid値がすでにµm（高さ）なので変換不要
    const isSurfaceCSV = plotType === "surface" && (!cloud || cloud.x.length === 0);
    const depthToUm = (rawVal: number) =>
      isSurfaceCSV ? rawVal : flipX ? (maxRawX - rawVal) * UM_PER_PIXEL_X : rawVal * UM_PER_PIXEL_X;

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
      const y0Px = isSurfaceCSV ? y0 : y0 / UM_PER_PIXEL_Y;
      const z0Px = isSurfaceCSV ? z0 : z0 / zUmPerSlice;
      const y1Px = isSurfaceCSV ? y1 : y1 / UM_PER_PIXEL_Y;
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
      let minY = cloud.y[0] * UM_PER_PIXEL_Y;
      let maxY = minY;
      let minZ = cloud.z[0] * zUmPerSlice;
      let maxZ = minZ;
      for (let i = 1; i < cloud.y.length; i++) {
        const yum = cloud.y[i] * UM_PER_PIXEL_Y;
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
        const py = cloud.y[i] * UM_PER_PIXEL_Y - y0;
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = { responsive: true, displaylogo: false };

    Plotly.newPlot(sliceEl, data, layout, config);

    return () => {
      Plotly.purge(sliceEl);
    };
  }, [
    showSlice,
    zData,
    cloud,
    sliceLineStart,
    sliceLineEnd,
    sweepInterval,
    sweepIntervalUnit,
    flipX,
    plotType,
  ]);

  const handleConfirmOk = async () => {
    if (confirmMode === "plot") {
      if (acquireTimerRef.current != null) {
        window.clearTimeout(acquireTimerRef.current);
      }

      // 表示初期化
      setShowSlice(false);
      setShowPlot(true);
      setZData(null);
      setCloud(null);

      // 進捗初期化
      setProgressStep(0);
      setProgressTotal(8);
      setProgressMessage("処理を開始中...");
      setProgressPercent(0);

      setStatus("RUNNING");
      setIsAcquiring(true);

      console.log("画像処理開始...");

      // WebSocketでpreprocessコマンドを送信
      const ws = connectWebSocket();

      const sendCommand = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              cmd: "preprocess",
              params: {
                peak_threshold: 10,
                use_gpu: useGpu,
                algorithm: algorithm,
              },
            })
          );
        } else {
          // 接続待ち
          setTimeout(sendCommand, 100);
        }
      };
      sendCommand();
    } else if (confirmMode === "ai") {
      // AI推論を実行
      setShowSlice(false);
      setShowPlot(true);
      setCloud(null);
      setIsLoadingAI(true);

      // 進捗初期化
      setProgressStep(0);
      setProgressTotal(6);
      setProgressMessage("AI推論を開始中...");
      setProgressPercent(0);

      setStatus("RUNNING");

      console.log("AI推論開始...");

      const ws = connectWebSocket();

      const sendCommand = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              cmd: "ai_inference",
              params: {},
            })
          );
        } else {
          setTimeout(sendCommand, 100);
        }
      };
      sendCommand();
    } else if (confirmMode === "csv") {
      if (zData) {
        await downloadCSV(zData, "surface.csv");
      } else {
        const fallback = addNoise(generateCoinData(GRID_SIZE), 0.1);
        await downloadCSV(fallback, "surface.csv");
      }
    }

    setShowConfirm(false);
    setConfirmMode(null);
  };

  // 「いいえ」の処理
  const handleConfirmCancel = () => {
    setShowConfirm(false);
    setConfirmMode(null);
  };

  // CSV読み込み処理
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const grid = parseCSV(text);
      if (grid.length === 0) {
        alert("CSVデータが空です");
        return;
      }
      // 2Dグリッド → PointCloud 変換
      const xArr: number[] = [];
      const yArr: number[] = [];
      const zArr: number[] = [];
      const cArr: number[] = [];
      for (let row = 0; row < grid.length; row++) {
        for (let col = 0; col < grid[row].length; col++) {
          const v = grid[row][col];
          if (v == null) continue;
          xArr.push(v);
          yArr.push(col);
          zArr.push(row);
          cArr.push(v);
        }
      }
      if (xArr.length === 0) {
        alert("有効なデータがありません");
        return;
      }
      const newCloud = { x: xArr, y: yArr, z: zArr, c: cArr };
      setShowSlice(false);
      setZData(grid);
      setCloud(newCloud);
      setPlotType("surface");
      setShowPlot(true);
      setStatus("COMPLETE");
      const now = new Date().toLocaleString("ja-JP");
      setLastMeasuredAt(now);
      setMeasureCount((c) => c + 1);
      const thumb = generateThumbnail(newCloud);
      setCloudHistory((prev) =>
        [
          {
            cloud: newCloud,
            measuredAt: now,
            points: newCloud.x.length,
            thumbnail: thumb,
            name: "",
            source: "csv" as HistorySource,
          },
          ...prev,
        ].slice(0, 5)
      );
    };
    reader.readAsText(file);
    // 同じファイルを再選択できるようにリセット
    e.target.value = "";
  };

  // AI推論の確認ダイアログを表示
  const handleShowAIResult = () => {
    setConfirmMode("ai");
    setShowConfirm(true);
  };

  // マスク画像を固定フォルダ(data/mask_result/)から読み込む
  const handleLoadMask = async () => {
    setShowSlice(false);
    setShowPlot(true);
    setCloud(null);
    setIsLoadingMask(true);
    setStatus("RUNNING");

    try {
      const { cloud: newCloud, grid: newGrid } = await buildPointCloudFromFolder({
        folderUrl: "/data/mask_result",
        threshold: 128,
        samplePerSlice: 4000,
        flipZ: flipZ,
        colorMode: "z",
        ...(algorithm === "tgv" ? { maxTotalPoints: 250_000 } : {}),
      });

      setCloud(newCloud);
      setZData(newGrid);
      setPlotType("surface");
      setStatus("COMPLETE");
      setLastMeasuredAt(new Date().toLocaleString("ja-JP"));
      setMeasureCount((c) => c + 1);

      // サムネイル生成＆履歴追加
      const thumb = generateThumbnail(newCloud);
      setCloudHistory((prev) =>
        [
          {
            cloud: newCloud,
            measuredAt: new Date().toLocaleString("ja-JP"),
            points: newCloud.x.length,
            thumbnail: thumb,
            name: "mask_result",
            source: "coin" as HistorySource,
          },
          ...prev,
        ].slice(0, 5)
      );
    } catch (e) {
      console.error(e);
      setStatus("READY");
      setShowPlot(false);
      alert(`マスク画像の読み込みに失敗しました: ${(e as Error).message}`);
    } finally {
      setIsLoadingMask(false);
    }
  };

  return (
    <>
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "grid",
          gridTemplateRows: "56px 52px 1fr",
          backgroundColor: colors.bg,
          color: colors.text,
          fontFamily: fontFamily,
          fontSize: "14px",
          lineHeight: 1.5,
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            height: "48px",
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            backgroundColor: "#6b737e",
            borderBottom: `1px solid ${colors.border}`,
            boxSizing: "border-box",
            gap: "10px",
          }}
        >
          <div
            ref={aboutRef}
            style={{ position: "relative" }}
            onClick={() => setShowAbout((prev) => !prev)}
          >
            <img
              src="/logo.jpg"
              alt="Company Logo"
              style={{ height: "28px", width: "auto", opacity: 0.95, cursor: "pointer" }}
            />

            {/* About Us ポップアップ */}
            {showAbout && (
              <div
                style={{
                  position: "absolute",
                  top: "36px",
                  left: "0",
                  width: "280px",
                  padding: "16px",
                  backgroundColor: "#565d68",
                  border: `1px solid ${colors.borderLight}`,
                  borderRadius: "8px",
                  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
                  zIndex: 100,
                }}
              >
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    marginBottom: "10px",
                    color: "#ffffff",
                  }}
                >
                  About Us
                </div>
                <div style={{ fontSize: "12px", color: "#ffffff", lineHeight: 1.6 }}>
                  光学デバイスから取得した3次元面形状をブラウザで可視化するWebアプリケーションです。
                </div>
                <div
                  style={{
                    marginTop: "12px",
                    paddingTop: "10px",
                    borderTop: `1px solid ${colors.borderLight}`,
                    fontSize: "11px",
                    color: "#ffffffcc",
                  }}
                >
                  <div>Version: 0.1.0</div>
                  <div style={{ marginTop: "4px" }}>© 2026 Trillion Technology</div>
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              fontFamily: '"Orbitron", sans-serif',
              fontWeight: 700,
              fontSize: "18px",
              letterSpacing: "2px",
              textTransform: "uppercase",
            }}
          >
            Tori-Ton UI
          </div>

          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            {lastMeasuredAt && (
              <div
                style={{
                  fontSize: "11px",
                  color: "#ffffff",
                  textAlign: "right",
                  lineHeight: 1.3,
                }}
              >
                <div>最新撮影日時</div>
                <div>{lastMeasuredAt}</div>
              </div>
            )}

            <div
              style={{
                fontSize: "11px",
                color: "#ffffff",
                textAlign: "right",
                lineHeight: 1.3,
              }}
            >
              <div>測定回数</div>
              <div>{measureCount}</div>
            </div>

            <StatusBadge status={status} />
          </div>
        </div>

        {/* ツールバー */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            height: "100%",
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "0 12px",
              backgroundColor: "#aab2be",
            }}
          >
            <div
              style={{
                display: "flex",
                borderRadius: "6px",
                overflow: "hidden",
                border: `1px solid ${colors.border}`,
                height: "44px",
              }}
            >
              {(
                [
                  { key: "3D", label: "3D", icon: "/icons/3d.png" },
                  { key: "2D-camera", label: "2D", icon: "/icons/2d.png" },
                ] as const
              ).map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => {
                    setViewMode(key);
                    if (key === "3D") setShowSlice(false);
                  }}
                  style={{
                    padding: "0 14px",
                    fontSize: "13px",
                    fontWeight: 600,
                    fontFamily,
                    border: "none",
                    borderRight: `1px solid ${colors.border}`,
                    cursor: "pointer",
                    backgroundColor: viewMode === key ? colors.primary : colors.bgDark,
                    color: viewMode === key ? "#fff" : colors.textMuted,
                    transition: "background-color 0.15s, color 0.15s",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  {icon && (
                    <img
                      src={icon}
                      alt=""
                      style={{
                        height: "18px",
                        width: "18px",
                        objectFit: "cover",
                        opacity: viewMode === key ? 1 : 0.6,
                        border: "1px solid #fff",
                        borderRadius: "2px",
                      }}
                    />
                  )}
                  {label}
                </button>
              ))}
            </div>

            {/* セパレータ */}
            <div
              style={{
                width: "1px",
                height: "28px",
                backgroundColor: "#7a8290",
                margin: "0 4px",
              }}
            />

            {/* Plotlyツールバーボタン群 */}
            {(() => {
              const tbBtnStyle = (active?: boolean): React.CSSProperties => ({
                width: "44px",
                height: "44px",
                padding: 0,
                border: "none",
                borderRadius: "6px",
                backgroundColor: active ? colors.primary : "transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background-color 0.15s",
              });
              const svgColor = "#2d3139";
              const activeColor = "#ffffff";

              const handleZoom = (factor: number) => {
                const el = plotRef.current;
                if (!el) return;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const scene = (el as any)._fullLayout?.scene?._scene;
                const camera = scene?.getCamera?.();
                if (camera) {
                  const eye = camera.eye;
                  Plotly.relayout(el, {
                    "scene.camera.eye": {
                      x: eye.x * factor,
                      y: eye.y * factor,
                      z: eye.z * factor,
                    },
                  });
                }
              };

              const handleDragMode = (mode: DragMode) => {
                const el = plotRef.current;
                if (!el) return;
                setDragMode(mode);
                Plotly.relayout(el, { "scene.dragmode": mode });
              };

              const handleReset = () => {
                const el = plotRef.current;
                if (!el) return;
                const cam =
                  viewMode === "2D-camera"
                    ? { eye: { x: 2.0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } }
                    : (() => {
                        const azim = 20;
                        const elev = 10;
                        const az = (azim * Math.PI) / 180;
                        const el2 = (elev * Math.PI) / 180;
                        return {
                          eye: {
                            x: 2.0 * Math.cos(az) * Math.cos(el2),
                            y: 2.0 * Math.sin(az) * Math.cos(el2),
                            z: 2.0 * Math.sin(el2) + 0.5,
                          },
                        };
                      })();
                Plotly.relayout(el, { "scene.camera": cam });
              };

              const handleDownload = () => {
                const el = plotRef.current;
                if (!el) return;
                Plotly.downloadImage(el, {
                  format: "png",
                  width: 1920,
                  height: 1080,
                  filename: "surface_plot",
                }).then(() => {
                  // WebGL 3Dプロットのキャンバスが白くなる問題を回避: 再描画
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const p = el as any;
                  if (p.data && p.layout) {
                    Plotly.react(el, p.data, p.layout);
                  }
                });
              };

              return (
                <>
                  {/* 画像保存 */}
                  <button title="画像保存" style={tbBtnStyle()} onClick={handleDownload}>
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={svgColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  </button>

                  {/* セパレータ */}
                  <div
                    style={{
                      width: "1px",
                      height: "28px",
                      backgroundColor: "#7a8290",
                      margin: "0 2px",
                    }}
                  />

                  {/* ズームイン */}
                  <button title="ズームイン" style={tbBtnStyle()} onClick={() => handleZoom(0.8)}>
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={svgColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      <line x1="11" y1="8" x2="11" y2="14" />
                      <line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                  </button>

                  {/* セパレータ */}
                  <div
                    style={{
                      width: "1px",
                      height: "28px",
                      backgroundColor: "#7a8290",
                      margin: "0 2px",
                    }}
                  />

                  {/* ズームアウト */}
                  <button
                    title="ズームアウト"
                    style={tbBtnStyle()}
                    onClick={() => handleZoom(1.25)}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={svgColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      <line x1="8" y1="11" x2="14" y2="11" />
                    </svg>
                  </button>

                  {/* セパレータ */}
                  <div
                    style={{
                      width: "1px",
                      height: "28px",
                      backgroundColor: "#7a8290",
                      margin: "0 2px",
                    }}
                  />

                  {/* パン */}
                  <button
                    title="パン"
                    style={tbBtnStyle(dragMode === "pan")}
                    onClick={() => handleDragMode("pan")}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={dragMode === "pan" ? activeColor : svgColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
                      <path d="M14 10V4a2 2 0 0 0-4 0v6" />
                      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
                      <path d="M18 11a2 2 0 0 1 4 0v5a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.6L3.3 17.8a2 2 0 0 1 3-2.6L8 18" />
                    </svg>
                  </button>

                  {/* セパレータ */}
                  <div
                    style={{
                      width: "1px",
                      height: "28px",
                      backgroundColor: "#7a8290",
                      margin: "0 2px",
                    }}
                  />

                  {/* 回転(Turntable) */}
                  <button
                    title="回転 (Turntable)"
                    style={tbBtnStyle(dragMode === "turntable")}
                    onClick={() => handleDragMode("turntable")}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={dragMode === "turntable" ? activeColor : svgColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 1 1-9-9" />
                      <polyline points="21 3 21 12 12 12" />
                    </svg>
                  </button>

                  {/* セパレータ */}
                  <div
                    style={{
                      width: "1px",
                      height: "28px",
                      backgroundColor: "#7a8290",
                      margin: "0 2px",
                    }}
                  />

                  {/* 回転(Orbital) */}
                  <button
                    title="回転 (Orbital)"
                    style={tbBtnStyle(dragMode === "orbit")}
                    onClick={() => handleDragMode("orbit")}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={dragMode === "orbit" ? activeColor : svgColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <ellipse cx="12" cy="12" rx="10" ry="4" />
                      <line x1="12" y1="2" x2="12" y2="22" />
                    </svg>
                  </button>

                  {/* セパレータ */}
                  <div
                    style={{
                      width: "1px",
                      height: "28px",
                      backgroundColor: "#7a8290",
                      margin: "0 2px",
                    }}
                  />

                  {/* 正面ビュー */}
                  <button
                    title="正面ビュー"
                    style={tbBtnStyle()}
                    onClick={() => {
                      const el = plotRef.current;
                      if (!el) return;
                      Plotly.relayout(el, {
                        "scene.camera": {
                          eye: { x: 2.0, y: 0, z: 0.5 },
                          up: { x: 0, y: 0, z: 1 },
                          center: { x: 0, y: 0, z: 0 },
                        },
                      });
                    }}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={svgColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="12" cy="12" r="2" fill={svgColor} />
                      <line x1="12" y1="6" x2="12" y2="10" />
                      <line x1="12" y1="14" x2="12" y2="18" />
                      <line x1="6" y1="12" x2="10" y2="12" />
                      <line x1="14" y1="12" x2="18" y2="12" />
                    </svg>
                  </button>

                  {/* 正面90°回転ビュー */}
                  <button
                    title="正面 90°回転"
                    style={tbBtnStyle()}
                    onClick={() => {
                      const el = plotRef.current;
                      if (!el) return;
                      Plotly.relayout(el, {
                        "scene.camera": {
                          eye: { x: 2.0, y: 0, z: 0.5 },
                          up: { x: 0, y: 1, z: 0 },
                          center: { x: 0, y: 0, z: 0 },
                        },
                      });
                    }}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={svgColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="12" cy="12" r="2" fill={svgColor} />
                      <line x1="12" y1="6" x2="12" y2="10" />
                      <line x1="12" y1="14" x2="12" y2="18" />
                      <line x1="6" y1="12" x2="10" y2="12" />
                      <line x1="14" y1="12" x2="18" y2="12" />
                      <path d="M17 4l2 2-2 2" fill="none" />
                    </svg>
                  </button>

                  {/* セパレータ */}
                  <div
                    style={{
                      width: "1px",
                      height: "28px",
                      backgroundColor: "#7a8290",
                      margin: "0 2px",
                    }}
                  />

                  {/* XY平面ビュー */}
                  <button
                    title="XY平面ビュー"
                    style={tbBtnStyle()}
                    onClick={() => {
                      const el = plotRef.current;
                      if (!el) return;
                      Plotly.relayout(el, {
                        "scene.camera": {
                          eye: { x: 0, y: 0, z: 2.0 },
                          up: { x: 0, y: 1, z: 0 },
                        },
                      });
                    }}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={svgColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <text
                        x="12"
                        y="15"
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="bold"
                        fill={svgColor}
                        stroke="none"
                      >
                        XY
                      </text>
                    </svg>
                  </button>

                  {/* セパレータ */}
                  <div
                    style={{
                      width: "1px",
                      height: "28px",
                      backgroundColor: "#7a8290",
                      margin: "0 2px",
                    }}
                  />

                  {/* XZ平面ビュー */}
                  <button
                    title="XZ平面ビュー"
                    style={tbBtnStyle()}
                    onClick={() => {
                      const el = plotRef.current;
                      if (!el) return;
                      Plotly.relayout(el, {
                        "scene.camera": {
                          eye: { x: 0, y: -2.0, z: 0 },
                          up: { x: 0, y: 0, z: 1 },
                        },
                      });
                    }}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={svgColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <text
                        x="12"
                        y="15"
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="bold"
                        fill={svgColor}
                        stroke="none"
                      >
                        XZ
                      </text>
                    </svg>
                  </button>

                  {/* セパレータ */}
                  <div
                    style={{
                      width: "1px",
                      height: "28px",
                      backgroundColor: "#7a8290",
                      margin: "0 2px",
                    }}
                  />

                  {/* YZ平面ビュー */}
                  <button
                    title="YZ平面ビュー"
                    style={tbBtnStyle()}
                    onClick={() => {
                      const el = plotRef.current;
                      if (!el) return;
                      Plotly.relayout(el, {
                        "scene.camera": {
                          eye: { x: 2.0, y: 0, z: 0 },
                          up: { x: 0, y: 0, z: 1 },
                        },
                      });
                    }}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={svgColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <text
                        x="12"
                        y="15"
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="bold"
                        fill={svgColor}
                        stroke="none"
                      >
                        YZ
                      </text>
                    </svg>
                  </button>

                  {/* セパレータ */}
                  <div
                    style={{
                      width: "1px",
                      height: "28px",
                      backgroundColor: "#7a8290",
                      margin: "0 2px",
                    }}
                  />

                  {/* リセット */}
                  <button title="カメラリセット" style={tbBtnStyle()} onClick={handleReset}>
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={svgColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                  </button>
                </>
              );
            })()}
          </div>
          <div style={{ backgroundColor: colors.bgLight }} />
        </div>

        {/* メインエリア */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            height: "100%",
            overflow: "hidden",
          }}
        >
          {/* 左：3D Plot + 2D断層 エリア */}
          <div
            style={{
              width: "100%",
              height: "100%",
              padding: "12px",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {/* 上：3D */}
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              <div ref={plotRef} style={{ width: "100%", height: "100%", position: "relative" }}>
                {!showPlot && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontSize: "15px",
                    }}
                  >
                    右側のボタンから3次元形状の
                    <br />
                    計測・表示を開始してください。
                  </div>
                )}

                {(isAcquiring || isLoadingAI) && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      color: colors.text,
                      fontSize: "15px",
                      backgroundColor: "rgba(45, 49, 57, 0.85)",
                      pointerEvents: "none",
                      textAlign: "center",
                      lineHeight: 1.6,
                      gap: "16px",
                    }}
                  >
                    <div style={{ fontSize: "18px", fontWeight: 600 }}>
                      {isLoadingAI ? "AI推論中..." : "画像処理中..."}
                    </div>

                    {/* 進捗バー */}
                    <div
                      style={{
                        width: "300px",
                        height: "8px",
                        backgroundColor: colors.border,
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${progressPercent}%`,
                          height: "100%",
                          backgroundColor: colors.primary,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>

                    <div style={{ fontSize: "14px" }}>
                      [{progressStep}/{progressTotal}] {progressMessage}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 下：2D 断層グラフ */}
            {showSlice && (
              <div style={{ height: "260px", flexShrink: 0 }}>
                <div ref={sliceRef} style={{ width: "100%", height: "100%" }} />
              </div>
            )}
          </div>

          {/* 右：サイドパネル */}
          <div
            style={{
              height: "100%",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              backgroundColor: "#2c3e56",
              boxSizing: "border-box",
              borderLeft: `1px solid #3a5068`,
            }}
          >
            {/* タブヘッダー */}
            <div
              style={{
                display: "flex",
                borderBottom: `1px solid ${colors.border}`,
                marginBottom: "4px",
              }}
            >
              {[
                { key: "settings" as const, label: "設定" },
                { key: "actions" as const, label: "操作" },
                { key: "result" as const, label: "測定結果" },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSideTab(key)}
                  style={{
                    height: "44px",
                    padding: "0 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    fontFamily,
                    color: sideTab === key ? colors.primary : colors.textMuted,
                    borderBottom:
                      sideTab === key ? `2px solid ${colors.primary}` : "2px solid transparent",
                    background: "none",
                    border: "none",
                    borderBottomWidth: "2px",
                    borderBottomStyle: "solid",
                    borderBottomColor: sideTab === key ? colors.primary : "transparent",
                    cursor: "pointer",
                    letterSpacing: "0.3px",
                    transition: "color 0.15s, border-color 0.15s",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 設定タブ */}
            {sideTab === "settings" && (
              <>
                {/* 掃引間隔 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "13px", color: colors.textMuted }}>掃引間隔</label>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <input
                      type="text"
                      placeholder="入力してください"
                      value={sweepInterval}
                      onChange={(e) => setSweepInterval(e.target.value)}
                      style={{
                        ...inputStyle,
                        width: "100px",
                        height: "32px",
                        padding: "4px 10px",
                      }}
                    />
                    <select
                      value={sweepIntervalUnit}
                      onChange={(e) => setSweepIntervalUnit(e.target.value as "um" | "mm")}
                      style={{ ...unitSelectStyle, height: "32px", padding: "4px 8px" }}
                    >
                      <option value="um">µm</option>
                      <option value="mm">mm</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            {/* 操作タブ */}
            {sideTab === "actions" && (
              <>
                {/* アルゴリズム選択（アコーディオン） */}
                <div
                  onClick={() => setShowAlgorithms((v) => !v)}
                  style={{
                    fontSize: "11px",
                    color: colors.textMuted,
                    marginBottom: showAlgorithms ? "6px" : "12px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    userSelect: "none",
                  }}
                >
                  <span>
                    アルゴリズム：
                    <span style={{ color: colors.primary, fontWeight: 600 }}>
                      {algorithm === "coin"
                        ? "硬貨"
                        : algorithm === "coin2"
                          ? "硬貨(別アプローチ)"
                          : algorithm === "tgv"
                            ? "TGV"
                            : algorithm === "elec"
                              ? "エレキ"
                              : algorithm === "medical"
                                ? "医療"
                                : "半導体"}
                    </span>
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transition: "transform 0.2s ease",
                      transform: showAlgorithms ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "4px",
                    marginBottom: "12px",
                    maxHeight: showAlgorithms ? "300px" : "0px",
                    overflow: "hidden",
                    transition: "max-height 0.25s ease",
                  }}
                >
                  {(["coin", "coin2", "tgv", "elec", "medical", "semi"] as const).map((alg) => {
                    const label =
                      alg === "coin"
                        ? "硬貨"
                        : alg === "coin2"
                          ? "硬貨(別アプローチ)"
                          : alg === "tgv"
                            ? "TGV"
                            : alg === "elec"
                              ? "エレキ"
                              : alg === "medical"
                                ? "医療"
                                : "半導体";
                    const icon =
                      alg === "coin" || alg === "coin2" ? (
                        <>
                          <circle cx="12" cy="12" r="9" />
                          <circle cx="12" cy="12" r="5" />
                        </>
                      ) : alg === "tgv" ? (
                        <>
                          <rect x="2" y="6" width="20" height="12" rx="1" />
                          <circle cx="12" cy="12" r="4" strokeDasharray="3 2" />
                        </>
                      ) : alg === "elec" ? (
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                      ) : alg === "medical" ? (
                        <>
                          <line x1="12" y1="4" x2="12" y2="20" />
                          <line x1="4" y1="12" x2="20" y2="12" />
                        </>
                      ) : (
                        <>
                          <rect x="4" y="4" width="16" height="16" rx="2" />
                          <rect x="8" y="8" width="8" height="8" rx="1" />
                          <line x1="8" y1="2" x2="8" y2="4" />
                          <line x1="12" y1="2" x2="12" y2="4" />
                          <line x1="16" y1="2" x2="16" y2="4" />
                          <line x1="8" y1="20" x2="8" y2="22" />
                          <line x1="12" y1="20" x2="12" y2="22" />
                          <line x1="16" y1="20" x2="16" y2="22" />
                          <line x1="2" y1="8" x2="4" y2="8" />
                          <line x1="2" y1="12" x2="4" y2="12" />
                          <line x1="2" y1="16" x2="4" y2="16" />
                          <line x1="20" y1="8" x2="22" y2="8" />
                          <line x1="20" y1="12" x2="22" y2="12" />
                          <line x1="20" y1="16" x2="22" y2="16" />
                        </>
                      );
                    return (
                      <button
                        key={alg}
                        onClick={() => setAlgorithm(alg)}
                        style={{
                          height: "44px",
                          borderRadius: "6px",
                          border: `1px solid ${algorithm === alg ? colors.primary : colors.border}`,
                          backgroundColor:
                            algorithm === alg ? colors.primary + "22" : "transparent",
                          color: algorithm === alg ? colors.primary : colors.textMuted,
                          fontSize: "11px",
                          fontWeight: algorithm === alg ? 600 : 400,
                          fontFamily: fontFamily,
                          cursor: "pointer",
                          transition: "all 0.15s",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "4px",
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          {icon}
                        </svg>
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* ボタングリッド（2列） */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  {/* AIでの結果を表示ボタン */}
                  <button
                    disabled={status === "RUNNING" || isLoadingAI}
                    style={{
                      ...buttonSecondaryStyle,
                      backgroundColor: "#0d9488",
                      border: "none",
                      cursor: status === "RUNNING" || isLoadingAI ? "not-allowed" : "pointer",
                      opacity: status === "RUNNING" || isLoadingAI ? 0.7 : 1,
                      fontSize: "12px",
                    }}
                    onClick={handleShowAIResult}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="5" cy="6" r="2" />
                      <circle cx="19" cy="6" r="2" />
                      <circle cx="5" cy="18" r="2" />
                      <circle cx="19" cy="18" r="2" />
                      <circle cx="12" cy="12" r="2.5" />
                      <line x1="7" y1="7" x2="10" y2="10" />
                      <line x1="14" y1="10" x2="17" y2="7" />
                      <line x1="7" y1="17" x2="10" y2="14" />
                      <line x1="14" y1="14" x2="17" y2="17" />
                    </svg>
                    {isLoadingAI ? "読込中..." : "AI"}
                  </button>

                  {/* CSV出力ボタン */}
                  <button
                    style={{
                      ...buttonSecondaryStyle,
                      backgroundColor: "#1e2d42",
                      border: `1px solid #3a5068`,
                      fontSize: "12px",
                    }}
                    onClick={() => {
                      setConfirmMode("csv");
                      setShowConfirm(true);
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    CSV出力
                  </button>

                  {/* 軸トグルボタン */}
                  <button
                    disabled={!showPlot}
                    onClick={() => {
                      if (!showPlot) return;
                      setAxisVisible((v) => !v);
                    }}
                    style={{
                      ...buttonSecondaryStyle,
                      backgroundColor: axisVisible ? "#4a6280" : "#1e2d42",
                      border: `1px solid #3a5068`,
                      cursor: showPlot ? "pointer" : "not-allowed",
                      opacity: showPlot ? 1 : 0.5,
                      fontSize: "12px",
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="4" y1="20" x2="4" y2="4" />
                      <line x1="4" y1="20" x2="20" y2="20" />
                      <polyline points="4 4 2 6" />
                      <polyline points="4 4 6 6" />
                      <polyline points="20 20 18 18" />
                      <polyline points="20 20 18 22" />
                    </svg>
                    {axisVisible ? "軸非表示" : "軸表示"}
                  </button>

                  {/* 左右反転トグルボタン */}
                  <button
                    disabled={!showPlot}
                    onClick={() => {
                      if (!showPlot) return;
                      setFlipX((v) => !v);
                    }}
                    style={{
                      ...buttonSecondaryStyle,
                      backgroundColor: flipX ? "#4a6280" : "#1e2d42",
                      border: `1px solid #3a5068`,
                      cursor: showPlot ? "pointer" : "not-allowed",
                      opacity: showPlot ? 1 : 0.5,
                      fontSize: "12px",
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="7 8 3 12 7 16" />
                      <polyline points="17 8 21 12 17 16" />
                      <line x1="3" y1="12" x2="10" y2="12" />
                      <line x1="14" y1="12" x2="21" y2="12" />
                      <line x1="12" y1="4" x2="12" y2="20" strokeDasharray="2 2" />
                    </svg>
                    {flipX ? "反転: ON" : "左右反転"}
                  </button>

                  {/* Y軸反転（鏡像補正）トグルボタン */}
                  <button
                    disabled={!showPlot}
                    onClick={() => {
                      if (!showPlot) return;
                      setFlipY((v) => !v);
                    }}
                    style={{
                      ...buttonSecondaryStyle,
                      backgroundColor: flipY ? "#4a6280" : "#1e2d42",
                      border: `1px solid #3a5068`,
                      cursor: showPlot ? "pointer" : "not-allowed",
                      opacity: showPlot ? 1 : 0.5,
                      fontSize: "12px",
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
                      <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
                      <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2 2" />
                      <polyline points="6 9 9 12 6 15" />
                      <polyline points="18 9 15 12 18 15" />
                    </svg>
                    {flipY ? "鏡像: ON" : "鏡像補正"}
                  </button>

                  {/* 距離計測ボタン */}
                  <button
                    disabled={!showPlot}
                    onClick={() => {
                      if (!showPlot) return;
                      const next = !measureMode;
                      setMeasureMode(next);
                      measureStateRef.current = { mode: next, pt1: null, pt2: null };
                      if (!next) {
                        setMeasurePt1(null);
                        setMeasurePt2(null);
                      }
                    }}
                    style={{
                      ...buttonSecondaryStyle,
                      backgroundColor: measureMode ? "#b45309" : "#1e2d42",
                      border: `1px solid ${measureMode ? "#d97706" : "#3a5068"}`,
                      cursor: showPlot ? "pointer" : "not-allowed",
                      opacity: showPlot ? 1 : 0.5,
                      fontSize: "12px",
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 12h4l1-3h2l2 6h2l1-3h4" />
                      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
                      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
                    </svg>
                    {measureMode ? "計測: ON" : "距離計測"}
                  </button>

                  {/* 断層 出力/停止 トグルボタン */}
                  <button
                    disabled={(!cloud && !zData) || viewMode !== "2D-camera"}
                    style={{
                      ...buttonSecondaryStyle,
                      border: "none",
                      backgroundColor: showSlice ? colors.danger : "#3d5a80",
                      cursor:
                        (cloud || zData) && viewMode === "2D-camera" ? "pointer" : "not-allowed",
                      opacity: (cloud || zData) && viewMode === "2D-camera" ? 1 : 0.5,
                      fontSize: "12px",
                    }}
                    onClick={() => {
                      if ((!cloud && !zData) || viewMode !== "2D-camera") return;
                      setShowSlice((v) => {
                        if (!v) {
                          setSliceLineStart(null);
                          setSliceLineEnd(null);
                        }
                        return !v;
                      });
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="6" width="20" height="12" rx="2" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                    </svg>
                    {showSlice ? "断層停止" : "断層出力"}
                  </button>

                  {/* CSV読み込みボタン */}
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv"
                    style={{ display: "none" }}
                    onChange={handleImportCSV}
                  />
                  <button
                    style={{
                      ...buttonSecondaryStyle,
                      backgroundColor: "#1e2d42",
                      border: `1px solid #3a5068`,
                      fontSize: "12px",
                    }}
                    onClick={() => csvInputRef.current?.click()}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    CSV読込
                  </button>

                  {/* マスク画像読込ボタン */}
                  <button
                    disabled={status === "RUNNING" || isLoadingMask}
                    style={{
                      ...buttonSecondaryStyle,
                      backgroundColor: "#7c3aed",
                      border: "none",
                      cursor: status === "RUNNING" || isLoadingMask ? "not-allowed" : "pointer",
                      opacity: status === "RUNNING" || isLoadingMask ? 0.7 : 1,
                      fontSize: "12px",
                    }}
                    onClick={handleLoadMask}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      <line x1="12" y1="11" x2="12" y2="17" />
                      <line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                    {isLoadingMask ? "読込中..." : "マスク読込"}
                  </button>
                </div>

                {/* 距離計測結果 */}
                {measureMode && (
                  <div
                    style={{
                      padding: "10px",
                      borderRadius: "6px",
                      backgroundColor: "#1a2332",
                      border: `1px solid #3a5068`,
                      fontSize: "12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                    }}
                  >
                    <div style={{ color: "#d97706", fontWeight: 600, marginBottom: "2px" }}>
                      距離計測モード
                    </div>
                    <div style={{ color: colors.textMuted, fontSize: "11px" }}>
                      3Dプロット上の2点をクリックしてください
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: colors.textMuted }}>点1</span>
                      <span>
                        {measurePt1
                          ? `(${measurePt1.x.toFixed(1)}, ${measurePt1.y.toFixed(1)}, ${measurePt1.z.toFixed(1)})`
                          : "—"}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: colors.textMuted }}>点2</span>
                      <span>
                        {measurePt2
                          ? `(${measurePt2.x.toFixed(1)}, ${measurePt2.y.toFixed(1)}, ${measurePt2.z.toFixed(1)})`
                          : "—"}
                      </span>
                    </div>
                    {measurePt1 && measurePt2 && (
                      <>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            borderTop: `1px solid #3a5068`,
                            paddingTop: "6px",
                            fontWeight: 600,
                            color: "#f59e0b",
                          }}
                        >
                          <span>距離</span>
                          <span>
                            {(() => {
                              const d = Math.sqrt(
                                (measurePt2.x - measurePt1.x) ** 2 +
                                  (measurePt2.y - measurePt1.y) ** 2 +
                                  (measurePt2.z - measurePt1.z) ** 2
                              );
                              return d >= 1000
                                ? `${(d / 1000).toFixed(3)} mm`
                                : `${d.toFixed(2)} µm`;
                            })()}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            measureStateRef.current = { mode: true, pt1: null, pt2: null };
                            setMeasurePt1(null);
                            setMeasurePt2(null);
                          }}
                          style={{
                            marginTop: "6px",
                            padding: "6px 0",
                            borderRadius: "4px",
                            border: `1px solid #3a5068`,
                            backgroundColor: "transparent",
                            color: colors.textMuted,
                            fontSize: "11px",
                            cursor: "pointer",
                            transition: "all 0.15s",
                          }}
                        >
                          再計測
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* 表示タイプ切替（Surface / Point Cloud） */}
                {showPlot && zData && zData.length > 0 && (
                  <>
                    <div style={{ fontSize: "11px", color: colors.textMuted, marginBottom: "6px" }}>
                      描画モード
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "4px",
                      }}
                    >
                      {(["surface", "scatter3d"] as const).map((pt) => (
                        <button
                          key={pt}
                          onClick={() => setPlotType(pt)}
                          style={{
                            flex: 1,
                            height: "32px",
                            borderRadius: "6px",
                            border: `1px solid ${plotType === pt ? colors.primary : colors.border}`,
                            backgroundColor:
                              plotType === pt ? colors.primary + "22" : "transparent",
                            color: plotType === pt ? colors.primary : colors.textMuted,
                            fontSize: "12px",
                            fontWeight: plotType === pt ? 600 : 400,
                            fontFamily: fontFamily,
                            cursor: "pointer",
                          }}
                        >
                          {pt === "surface" ? "Surface" : "Point Cloud"}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {/* 測定結果タブ */}
            {sideTab === "result" && (
              <>
                {cloud ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div
                      style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}
                    >
                      <span style={{ color: colors.textMuted }}>点数</span>
                      <span>{cloud.x.length.toLocaleString()} pts</span>
                    </div>
                    <div
                      style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}
                    >
                      <span style={{ color: colors.textMuted }}>閾値</span>
                      <span>{">"} 128</span>
                    </div>
                    <div
                      style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}
                    >
                      <span style={{ color: colors.textMuted }}>表示モード</span>
                      <span>{viewMode === "3D" ? "3D" : "2D"}</span>
                    </div>
                    <div
                      style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}
                    >
                      <span style={{ color: colors.textMuted }}>カラー軸</span>
                      <span>{viewMode === "2D-camera" ? "X (depth)" : "Z (flipped)"}</span>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: "13px",
                      color: colors.textMuted,
                      textAlign: "center",
                      marginTop: "20px",
                    }}
                  >
                    計測データがありません
                  </div>
                )}

                {/* 測定履歴 */}
                {cloudHistory.length > 0 && (
                  <div style={{ marginTop: "16px" }}>
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: colors.textMuted,
                        marginBottom: "8px",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      測定履歴（最新5件）
                    </div>
                    {(
                      [
                        "coin",
                        "coin2",
                        "tgv",
                        "elec",
                        "medical",
                        "semi",
                        "csv",
                        "ai",
                      ] as HistorySource[]
                    ).map((src) => {
                      const entries = cloudHistory
                        .map((e, i) => ({ entry: e, idx: i }))
                        .filter(({ entry }) => entry.source === src);
                      if (entries.length === 0) return null;
                      const srcLabel =
                        src === "coin"
                          ? "硬貨"
                          : src === "coin2"
                            ? "硬貨(別アプローチ)"
                            : src === "tgv"
                              ? "TGV"
                              : src === "elec"
                                ? "エレキ"
                                : src === "medical"
                                  ? "医療"
                                  : src === "semi"
                                    ? "半導体"
                                    : "CSVインポート";
                      return (
                        <div key={src} style={{ marginBottom: "10px" }}>
                          <div
                            style={{
                              fontSize: "11px",
                              color: colors.textMuted,
                              marginBottom: "4px",
                            }}
                          >
                            {srcLabel}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            {entries.map(({ entry, idx: i }) => {
                              const isCurrent = cloud === entry.cloud;
                              return (
                                <div
                                  key={entry.measuredAt + i}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "8px 10px",
                                    borderRadius: "6px",
                                    backgroundColor: isCurrent
                                      ? colors.primary + "22"
                                      : colors.bgDark,
                                    border: isCurrent
                                      ? `1px solid ${colors.primary}`
                                      : `1px solid ${colors.border}`,
                                  }}
                                >
                                  <div
                                    style={{ display: "flex", alignItems: "center", gap: "8px" }}
                                  >
                                    <img
                                      src={entry.thumbnail}
                                      alt={`#${cloudHistory.length - i}`}
                                      style={{
                                        width: "48px",
                                        height: "48px",
                                        borderRadius: "4px",
                                        border: `1px solid ${colors.border}`,
                                        flexShrink: 0,
                                      }}
                                    />
                                    <div
                                      style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "2px",
                                      }}
                                    >
                                      {editingNameIdx === i ? (
                                        <input
                                          autoFocus
                                          value={editingNameValue}
                                          onChange={(e) => setEditingNameValue(e.target.value)}
                                          onBlur={() => {
                                            setCloudHistory((prev) =>
                                              prev.map((h, idx) =>
                                                idx === i
                                                  ? { ...h, name: editingNameValue.trim() }
                                                  : h
                                              )
                                            );
                                            setEditingNameIdx(null);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                              (e.target as HTMLInputElement).blur();
                                            if (e.key === "Escape") setEditingNameIdx(null);
                                          }}
                                          placeholder={`#${cloudHistory.length - i}`}
                                          style={{
                                            fontSize: "12px",
                                            fontWeight: 600,
                                            fontFamily,
                                            width: "100px",
                                            padding: "1px 4px",
                                            border: `1px solid ${colors.primary}`,
                                            borderRadius: "3px",
                                            backgroundColor: colors.bgDark,
                                            color: colors.text,
                                            outline: "none",
                                          }}
                                        />
                                      ) : (
                                        <span
                                          style={{
                                            fontSize: "12px",
                                            fontWeight: 600,
                                            cursor: "pointer",
                                          }}
                                          title="クリックで名前を変更"
                                          onClick={() => {
                                            setEditingNameIdx(i);
                                            setEditingNameValue(entry.name);
                                          }}
                                        >
                                          {entry.name || `#${cloudHistory.length - i}`}
                                        </span>
                                      )}
                                      <span style={{ fontSize: "11px", color: colors.textMuted }}>
                                        {entry.measuredAt}
                                      </span>
                                      <span style={{ fontSize: "11px", color: colors.textMuted }}>
                                        {entry.points.toLocaleString()} pts
                                      </span>
                                    </div>
                                  </div>
                                  <div
                                    style={{ display: "flex", gap: "4px", alignItems: "center" }}
                                  >
                                    {isCurrent ? (
                                      <span
                                        style={{
                                          fontSize: "11px",
                                          color: colors.primary,
                                          fontWeight: 600,
                                        }}
                                      >
                                        表示中
                                      </span>
                                    ) : (
                                      <button
                                        style={{
                                          padding: "4px 10px",
                                          fontSize: "11px",
                                          fontWeight: 600,
                                          fontFamily,
                                          border: `1px solid ${colors.primary}`,
                                          borderRadius: "4px",
                                          backgroundColor: "transparent",
                                          color: colors.primary,
                                          cursor: "pointer",
                                        }}
                                        onClick={() => {
                                          setShowSlice(false);
                                          setCloud(entry.cloud);
                                          setShowPlot(true);
                                        }}
                                      >
                                        復元
                                      </button>
                                    )}
                                    <button
                                      style={{
                                        padding: "4px 10px",
                                        fontSize: "11px",
                                        fontWeight: 600,
                                        fontFamily,
                                        border: `1px solid ${colors.danger}`,
                                        borderRadius: "4px",
                                        backgroundColor: "transparent",
                                        color: colors.danger,
                                        cursor: "pointer",
                                      }}
                                      onClick={() => setDeleteConfirmIdx(i)}
                                    >
                                      削除
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <div style={{ flexGrow: 1 }} />

            {/* STARTボタン（CPU/GPU）- タブ外で常時表示 */}
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                disabled={status === "RUNNING"}
                style={{
                  ...buttonPrimaryStyle,
                  flex: 1,
                  height: "56px",
                  fontSize: "16px",
                  backgroundColor: status === "RUNNING" ? "#4a6280" : "#4a90e2",
                  cursor: status === "RUNNING" ? "not-allowed" : "pointer",
                  opacity: status === "RUNNING" ? 0.7 : 1,
                }}
                onClick={() => {
                  setUseGpu(false);
                  setConfirmMode("plot");
                  setShowConfirm(true);
                }}
              >
                {status === "RUNNING" ? (
                  "処理中..."
                ) : (
                  <>
                    <span style={{ fontSize: "40px", lineHeight: 1 }}>▶</span> CPU
                  </>
                )}
              </button>
              <button
                disabled={status === "RUNNING"}
                style={{
                  ...buttonPrimaryStyle,
                  flex: 1,
                  height: "56px",
                  fontSize: "16px",
                  backgroundColor: status === "RUNNING" ? "#4a6280" : "#e2894a",
                  cursor: status === "RUNNING" ? "not-allowed" : "pointer",
                  opacity: status === "RUNNING" ? 0.7 : 1,
                }}
                onClick={() => {
                  setUseGpu(true);
                  setConfirmMode("plot");
                  setShowConfirm(true);
                }}
              >
                {status === "RUNNING" ? (
                  "処理中..."
                ) : (
                  <>
                    <span style={{ fontSize: "40px", lineHeight: 1 }}>▶</span> GPU
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 確認モーダル */}
      {showConfirm && confirmMode && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: "320px",
              backgroundColor: colors.bgLight,
              borderRadius: "10px",
              padding: "20px 24px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
              boxSizing: "border-box",
              border: `1px solid ${colors.border}`,
            }}
          >
            <div
              style={{
                fontSize: "15px",
                marginBottom: "20px",
                fontWeight: 500,
                lineHeight: 1.6,
              }}
            >
              {confirmMode === "csv" ? (
                "csvファイルを出力しますか？"
              ) : confirmMode === "ai" ? (
                "AI推論を実行しますか？"
              ) : (
                <>
                  3次元形状計測を開始しますか？
                  <br />（{useGpu ? "GPU" : "CPU"}モード /{" "}
                  {algorithm === "tgv"
                    ? "TGV"
                    : algorithm === "elec"
                      ? "エレキ"
                      : algorithm === "medical"
                        ? "医療"
                        : algorithm === "semi"
                          ? "半導体"
                          : algorithm === "coin2"
                            ? "硬貨(別アプローチ)"
                            : "硬貨"}
                  ）
                </>
              )}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
              }}
            >
              <button
                style={{
                  height: "44px",
                  padding: "0 18px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: colors.secondary,
                  color: colors.text,
                  fontSize: "13px",
                  fontWeight: 500,
                  fontFamily: fontFamily,
                  cursor: "pointer",
                  transition: "background-color 0.2s",
                }}
                onClick={handleConfirmCancel}
              >
                いいえ
              </button>
              <button
                style={{
                  height: "44px",
                  padding: "0 18px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: colors.primary,
                  color: colors.text,
                  fontSize: "13px",
                  fontWeight: 600,
                  fontFamily: fontFamily,
                  cursor: "pointer",
                  transition: "background-color 0.2s",
                }}
                onClick={handleConfirmOk}
              >
                はい
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirmIdx !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={() => setDeleteConfirmIdx(null)}
        >
          <div
            style={{
              backgroundColor: colors.bgLight,
              border: `1px solid ${colors.border}`,
              borderRadius: "8px",
              padding: "24px",
              minWidth: "280px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ margin: "0 0 16px", fontSize: "14px", color: colors.text }}>
              この測定履歴を削除しますか？
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
              <button
                style={{
                  padding: "6px 20px",
                  fontSize: "13px",
                  fontWeight: 600,
                  fontFamily,
                  border: `1px solid ${colors.border}`,
                  borderRadius: "4px",
                  backgroundColor: "transparent",
                  color: colors.text,
                  cursor: "pointer",
                }}
                onClick={() => setDeleteConfirmIdx(null)}
              >
                キャンセル
              </button>
              <button
                style={{
                  padding: "6px 20px",
                  fontSize: "13px",
                  fontWeight: 600,
                  fontFamily,
                  border: "none",
                  borderRadius: "4px",
                  backgroundColor: colors.danger,
                  color: "#fff",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setCloudHistory((prev) => prev.filter((_, j) => j !== deleteConfirmIdx));
                  setDeleteConfirmIdx(null);
                }}
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
