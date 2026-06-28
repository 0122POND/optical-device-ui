import { useEffect, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { generateCoinData, addNoise } from "./utils/surface";
import { downloadCSV, parseCSV } from "./utils/csv";
import { buildPointCloudFromFolder, type PointCloud } from "./utils/pointCloud";
import { useWebSocket } from "./hooks/useWebSocket";
import { useElapsedTimer } from "./hooks/useElapsedTimer";
import { useCloudHistory } from "./hooks/useCloudHistory";
import {
  DEFAULT_UM_PER_PIXEL_X,
  DEFAULT_UM_PER_PIXEL_Y,
  DIM_COLORS,
  CSV_MAX_TOTAL_POINTS,
  colors,
  fontFamily,
} from "./utils/constants";
import { formatElapsed } from "./utils/format";
import { Header } from "./components/Header";
import { SettingsTab } from "./components/SettingsTab";
import { ResultTab } from "./components/ResultTab";
import { useSlicePlot } from "./hooks/useSlicePlot";
import { usePlotly } from "./hooks/usePlotly";
import { buttonPrimaryStyle, buttonSecondaryStyle } from "./utils/styles";
import type {
  PlotType,
  HistorySource,
  MeasureStatus,
  ViewMode,
  MeasureState,
  DimLine,
} from "./types";
import "./App.css";

function App() {
  const GRID_SIZE = 80;
  const plotRef = useRef<HTMLDivElement | null>(null);
  const sliceRef = useRef<HTMLDivElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  // 表示モード
  const [viewMode, setViewMode] = useState<ViewMode>("3D");

  // 軸表示フラグ（true = 表示 / false = 非表示）
  const [axisVisible, setAxisVisible] = useState(true);

  // 左右反転フラグ（true = 反転 / false = 通常）
  const [flipX, setFlipX] = useState(false);

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
  // 断層グラフ上での2点間距離計測（t=距離[µm], d=深さ[µm]）
  const [sliceMeasureStart, setSliceMeasureStart] = useState<{ t: number; d: number } | null>(null);
  const [sliceMeasureEnd, setSliceMeasureEnd] = useState<{ t: number; d: number } | null>(null);

  // 距離計測
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePt1, setMeasurePt1] = useState<{ x: number; y: number; z: number } | null>(null);
  const [measurePt2, setMeasurePt2] = useState<{ x: number; y: number; z: number } | null>(null);
  const measureStateRef = useRef<MeasureState>({
    mode: false,
    pt1: null,
    pt2: null,
  });

  // 寸法測定モード（2D: ドラッグ可能な両矢印で任意2点間の距離を測る。複数本対応）
  const [dimensionMode, setDimensionMode] = useState(false);
  // 寸法線の端点座標（軸の物理単位）。再描画をまたいで位置を保持する
  // lx/ly: ユーザーが手動でずらしたラベル位置（軸の物理単位）。null なら線の中点付近に自動配置
  const dimLinesRef = useRef<DimLine[]>([]);
  const dimIdRef = useRef(0);
  // 直近の描画範囲（寸法線の新規追加・配置に使う）
  const dimRangeRef = useRef<{ xMin: number; xMax: number; yMin: number; yMax: number } | null>(
    null
  );
  // 寸法線の追加・削除で再描画を促すためのバージョン
  const [dimLineVersion, setDimLineVersion] = useState(0);
  // Shift押下中はドラッグした端点を水平/垂直へスナップ（直交固定）
  const shiftHeldRef = useRef(false);
  // 寸法読み取り値（サイドパネル表示用。線ごと）
  const [dimReadouts, setDimReadouts] = useState<
    {
      id: number;
      dist: number;
      dx: number;
      dy: number;
      unit: string;
    }[]
  >([]);

  // 寸法線を1本追加（直近の描画範囲を基準に中央付近へ配置。重ならないよう縦にずらす）
  const addDimLine = () => {
    const r = dimRangeRef.current;
    if (!r) return;
    const n = dimLinesRef.current.length;
    const frac = Math.min(0.85, Math.max(0.15, 0.5 + ((n % 6) - 2) * 0.12));
    const y = r.yMin + (r.yMax - r.yMin) * frac;
    dimLinesRef.current = [
      ...dimLinesRef.current,
      {
        id: ++dimIdRef.current,
        x0: r.xMin + (r.xMax - r.xMin) * 0.25,
        x1: r.xMin + (r.xMax - r.xMin) * 0.75,
        y0: y,
        y1: y,
      },
    ];
    setDimLineVersion((v) => v + 1);
  };

  // Shiftキーの押下状態を追跡（寸法線ドラッグ時の直交スナップに使用）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftHeldRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftHeldRef.current = false;
    };
    const onBlur = () => {
      shiftHeldRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // 指定IDの寸法線を削除（0本になったら次の再描画で1本自動生成）
  const removeDimLine = (id: number) => {
    dimLinesRef.current = dimLinesRef.current.filter((l) => l.id !== id);
    setDimLineVersion((v) => v + 1);
  };

  const [status, setStatus] = useState<MeasureStatus>("READY");

  // 掃引関連の入力値 & 単位
  const [sweepInterval, setSweepInterval] = useState("100");
  const [sweepIntervalUnit, setSweepIntervalUnit] = useState<"um" | "mm">("um");
  // X/Y軸 µm/pix 換算係数（可変設定）
  const [umPerPixelXInput, setUmPerPixelXInput] = useState(String(DEFAULT_UM_PER_PIXEL_X));
  const [umPerPixelYInput, setUmPerPixelYInput] = useState(String(DEFAULT_UM_PER_PIXEL_Y));
  const umPerPixelX = (() => {
    const v = parseFloat(umPerPixelXInput);
    return !isNaN(v) && v > 0 ? v : DEFAULT_UM_PER_PIXEL_X;
  })();
  const umPerPixelY = (() => {
    const v = parseFloat(umPerPixelYInput);
    return !isNaN(v) && v > 0 ? v : DEFAULT_UM_PER_PIXEL_Y;
  })();

  const [zData, setZData] = useState<(number | null)[][] | null>(null);
  const [cloud, setCloud] = useState<PointCloud | null>(null);

  // 表示タイプ（scatter3d: 点群 / surface: サーフェス）
  const [plotType, setPlotType] = useState<PlotType>("scatter3d");

  // 測定履歴（最大5件）。データ管理は useCloudHistory に集約、UI状態(編集/削除)は App 保持
  const { history: cloudHistory, pushEntry, renameEntry, removeEntry } = useCloudHistory();
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

  // 取得した点群を状態へ反映する共通処理（WS完了 / CSV取込 / マスク読込で共有）。
  // 共通コア（cloud/zData/status/履歴/計測回数）に加え、plotType・source・進捗・
  // ロード解除フラグを opts で出し分ける。showPlot/showSlice は呼び出し側の責務。
  const applyCloudResult = (
    newCloud: PointCloud,
    grid: (number | null)[][] | null,
    opts: {
      plotType: PlotType;
      source: HistorySource;
      name?: string;
      progress?: { message: string; percent: number };
      clearLoading?: "ai" | "acquire";
    }
  ) => {
    setCloud(newCloud);
    setZData(grid);
    setPlotType(opts.plotType);
    setStatus("COMPLETE");
    if (opts.progress) {
      setProgressMessage(opts.progress.message);
      setProgressPercent(opts.progress.percent);
    }
    if (opts.clearLoading === "ai") setIsLoadingAI(false);
    else if (opts.clearLoading === "acquire") setIsAcquiring(false);
    const now = new Date().toLocaleString("ja-JP");
    setLastMeasuredAt(now);
    setMeasureCount((c) => c + 1);
    const thumb = generateThumbnail(newCloud);
    pushEntry({
      cloud: newCloud,
      measuredAt: now,
      points: newCloud.x.length,
      thumbnail: thumb,
      name: opts.name ?? "",
      source: opts.source,
    });
  };
  // WebSocket 接続・onmessage ルーティングは useWebSocket フックへ集約。
  // 完了時の点群反映は applyCloudResult、進捗・状態・エラーはコールバックで App 側へ委譲。
  const { connect } = useWebSocket({
    algorithm,
    applyCloudResult,
    onProgress: (p) => {
      setProgressStep(p.step);
      setProgressTotal(p.total);
      setProgressMessage(p.message);
      setProgressPercent(p.percent);
    },
    onStatus: (value) => setStatus(value),
    onError: (kind, msg) => {
      if (kind === "ai") setIsLoadingAI(false);
      else setIsAcquiring(false); // acquire / generic とも取得中フラグを下ろす
      setStatus("READY");
      if (kind !== "generic") setShowPlot(false); // generic(error型)は従来どおり非表示にしない
      alert(
        kind === "ai"
          ? `AI結果の点群生成に失敗しました: ${msg}`
          : kind === "acquire"
            ? `点群生成に失敗しました: ${msg}`
            : `エラー: ${msg}`
      );
    },
  });

  // 進捗表示用
  const [progressStep, setProgressStep] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);

  // 処理経過時間（RUNNING中はカウントアップ、終了時に確定）
  const elapsedMs = useElapsedTimer(status);

  // 取得中フラグ
  const [isAcquiring, setIsAcquiring] = useState(false);

  // AI結果読み込み中フラグ
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  // AIモデルタイプ選択
  type AiModelType =
    | "resnet34"
    | "resnet50"
    | "resnet101"
    | "resnet152"
    | "deeplabv3plus_effv2m"
    | "segformer_b2"
    | "unetpp_effv2m"
    | "unetpp_effv2l"
    | "unetpp_2_5d";
  const [aiModelType, setAiModelType] = useState<AiModelType>("resnet50");

  // マスク読込中フラグ
  const [isLoadingMask, setIsLoadingMask] = useState(false);

  // サイドパネルのタブ
  type SideTab = "settings" | "actions" | "result";
  const [sideTab, setSideTab] = useState<SideTab>("actions");

  // ドラッグモード（pan / turntable / orbit）
  type DragMode = "pan" | "turntable" | "orbit";
  const [dragMode, setDragMode] = useState<DragMode>("turntable");

  // アルゴリズム選択アコーディオンの開閉
  const [showAlgorithms, setShowAlgorithms] = useState(false);

  // 最終計測日時
  const [lastMeasuredAt, setLastMeasuredAt] = useState<string | null>(null);

  // 測定回数
  const [measureCount, setMeasureCount] = useState(0);

  // setTimeout のID保持（連打対策 & アンマウント対策）
  const acquireTimerRef = useRef<number | null>(null);

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

  // --- メイン3D/2D描画（plotRef へ。pointGeom・クリック・寸法ドラッグ・カメラ保持を内包） ---
  usePlotly({
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
  });

  // --- 2D 断層グラフ描画（sliceRef へ） ---
  useSlicePlot({
    sliceRef,
    showSlice,
    zData,
    cloud,
    sliceLineStart,
    sliceLineEnd,
    sweepInterval,
    sweepIntervalUnit,
    umPerPixelX,
    umPerPixelY,
    flipX,
    plotType,
    sliceMeasureStart,
    sliceMeasureEnd,
    setSliceMeasureStart,
    setSliceMeasureEnd,
  });

  // 断面線の選び直し・断層非表示時は、旧座標系の距離計測をクリアする
  useEffect(() => {
    setSliceMeasureStart(null);
    setSliceMeasureEnd(null);
  }, [sliceLineStart, sliceLineEnd, showSlice]);

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
      const ws = connect();

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

      const ws = connect();

      const sendCommand = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              cmd: "ai_inference",
              params: { model_type: aiModelType },
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

  // CSVテキストを取り込み、3Dプロット表示まで行う共通処理
  const loadCsvText = (text: string, source: HistorySource = "csv") => {
    const grid = parseCSV(text);
    if (grid.length === 0) {
      alert("CSVデータが空です");
      return;
    }
    // 展開とランダム間引きを1パスで行う（reservoir sampling）。
    // 全有効点を一旦配列に展開→全インデックスをシャッフルする旧方式は、巨大CSVで
    // メインスレッドを数秒凍結させた。上限 CSV_MAX_TOTAL_POINTS 件だけを保持しながら
    // 走査することで、確保するメモリ・計算量を点数ではなく上限値に比例させる。
    const MAX = CSV_MAX_TOTAL_POINTS;
    const sx: number[] = [];
    const sy: number[] = [];
    const sz: number[] = [];
    const sseq: number[] = []; // 各サンプルの元の出現順（間引き後に並び順を復元するため）
    let seen = 0; // これまでに見た有効点の数
    for (let row = 0; row < grid.length; row++) {
      const gridRow = grid[row];
      for (let col = 0; col < gridRow.length; col++) {
        const v = gridRow[col];
        if (v == null) continue;
        if (seen < MAX) {
          sx.push(v);
          sy.push(col);
          sz.push(row);
          sseq.push(seen);
        } else {
          // 既に上限に達している場合は確率 MAX/(seen+1) で既存サンプルと置換
          const j = Math.floor(Math.random() * (seen + 1));
          if (j < MAX) {
            sx[j] = v;
            sy[j] = col;
            sz[j] = row;
            sseq[j] = seen;
          }
        }
        seen++;
      }
    }
    if (seen === 0) {
      alert("有効なデータがありません");
      return;
    }
    // 間引きが発生した場合のみ、サンプルを元の出現順に並べ直す（c は値=深さなので x と共有）
    let cx = sx,
      cy = sy,
      cz = sz;
    if (seen > MAX) {
      const order = Array.from({ length: MAX }, (_, i) => i).sort((a, b) => sseq[a] - sseq[b]);
      cx = order.map((i) => sx[i]);
      cy = order.map((i) => sy[i]);
      cz = order.map((i) => sz[i]);
    }
    const newCloud = { x: cx, y: cy, z: cz, c: cx };
    setShowSlice(false);
    setShowPlot(true);
    applyCloudResult(newCloud, grid, { plotType: "surface", source });
  };

  // CSV読み込み処理
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      loadCsvText(reader.result as string, "csv");
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
        flipZ: false,
        colorMode: "z",
        ...(algorithm === "tgv" ? { maxTotalPoints: 250_000 } : {}),
      });

      applyCloudResult(newCloud, newGrid, {
        plotType: "surface",
        source: "coin",
        name: "mask_result",
      });
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
        <Header lastMeasuredAt={lastMeasuredAt} measureCount={measureCount} status={status} />

        {/* ツールバー */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            height: "100%",
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
            borderBottom: `1px solid ${colors.border}`,
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
                    if (key === "3D") {
                      setShowSlice(false);
                      setDimensionMode(false);
                    }
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
          {/* 右セルはサイドパネルと背景・左ボーダーを揃え、上の隙間を解消して連続させる */}
          <div style={{ backgroundColor: "#2c3e56", borderLeft: `1px solid #3a5068` }} />
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
                    <div style={{ fontSize: "13px", opacity: 0.8 }}>
                      経過時間: {formatElapsed(elapsedMs)}
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
              <SettingsTab
                sweepInterval={sweepInterval}
                setSweepInterval={setSweepInterval}
                sweepIntervalUnit={sweepIntervalUnit}
                setSweepIntervalUnit={setSweepIntervalUnit}
                umPerPixelXInput={umPerPixelXInput}
                setUmPerPixelXInput={setUmPerPixelXInput}
                umPerPixelYInput={umPerPixelYInput}
                setUmPerPixelYInput={setUmPerPixelYInput}
              />
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
                    const disabled = alg !== "coin";
                    return (
                      <button
                        key={alg}
                        onClick={() => {
                          if (disabled) return;
                          setAlgorithm(alg);
                        }}
                        disabled={disabled}
                        title={disabled ? "現在は「硬貨」のみ選択可能です" : ""}
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
                          cursor: disabled ? "not-allowed" : "pointer",
                          opacity: disabled ? 0.4 : 1,
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

                  {/* 寸法測定（2D 両矢印ドラッグ）トグルボタン */}
                  <button
                    disabled={viewMode !== "2D-camera" || !zData || zData.length === 0}
                    onClick={() => {
                      if (viewMode !== "2D-camera" || !zData || zData.length === 0) return;
                      const next = !dimensionMode;
                      setDimensionMode(next);
                      if (next) {
                        // 競合する他モードを解除
                        setShowSlice(false);
                        setMeasureMode(false);
                        measureStateRef.current = { mode: false, pt1: null, pt2: null };
                        setMeasurePt1(null);
                        setMeasurePt2(null);
                      } else {
                        setDimReadouts([]);
                      }
                    }}
                    style={{
                      ...buttonSecondaryStyle,
                      backgroundColor: dimensionMode ? "#0e7490" : "#1e2d42",
                      border: `1px solid ${dimensionMode ? "#22d3ee" : "#3a5068"}`,
                      cursor:
                        viewMode === "2D-camera" && zData && zData.length > 0
                          ? "pointer"
                          : "not-allowed",
                      opacity: viewMode === "2D-camera" && zData && zData.length > 0 ? 1 : 0.5,
                      fontSize: "12px",
                    }}
                    title="2D表示で両矢印をドラッグし、任意2点間の寸法を測る"
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
                      <line x1="3" y1="12" x2="21" y2="12" />
                      <polyline points="6 9 3 12 6 15" />
                      <polyline points="18 9 21 12 18 15" />
                    </svg>
                    {dimensionMode ? "寸法: ON" : "寸法測定"}
                  </button>

                  {/* 寸法読み取り値（線ごと） */}
                  {dimensionMode && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          onClick={addDimLine}
                          style={{
                            ...buttonSecondaryStyle,
                            flex: 1,
                            backgroundColor: "#0e7490",
                            border: "1px solid #22d3ee",
                            fontSize: "12px",
                          }}
                          title="寸法線をもう1本追加する"
                        >
                          ＋ 寸法線を追加
                        </button>
                      </div>
                      {dimReadouts.map((r, idx) => {
                        const color = DIM_COLORS[idx % DIM_COLORS.length];
                        return (
                          <div
                            key={r.id}
                            style={{
                              padding: "8px 10px",
                              borderRadius: "6px",
                              backgroundColor: "#0b1f2a",
                              border: `1px solid ${color}`,
                              fontSize: "12px",
                              color: "#e0f2fe",
                              lineHeight: 1.6,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <div style={{ fontWeight: 600, color }}>
                                {dimReadouts.length > 1 ? `${idx + 1}. ` : ""}距離:{" "}
                                {r.unit === "µm" && r.dist >= 1000
                                  ? `${r.dist.toFixed(1)} µm (${(r.dist / 1000).toFixed(3)} mm)`
                                  : `${r.dist.toFixed(1)} ${r.unit}`}
                              </div>
                              <button
                                onClick={() => removeDimLine(r.id)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "#94a3b8",
                                  cursor: "pointer",
                                  fontSize: "14px",
                                  lineHeight: 1,
                                  padding: "0 2px",
                                }}
                                title="この寸法線を削除"
                              >
                                ✕
                              </button>
                            </div>
                            <div style={{ color: "#7dd3fc" }}>
                              ΔX: {r.dx.toFixed(1)} {r.unit} ／ ΔY: {r.dy.toFixed(1)} {r.unit}
                            </div>
                          </div>
                        );
                      })}
                      <div style={{ color: "#5b7a8a", fontSize: "11px" }}>
                        矢印の端点をドラッグして測りたい2点に合わせてください。Shiftを押しながらドラッグすると水平/垂直に固定できます。数値ボックスはドラッグで自由に移動できます
                      </div>
                    </div>
                  )}

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
                            color: colors.textMuted,
                            fontSize: "11px",
                            borderTop: `1px solid #3a5068`,
                            paddingTop: "6px",
                          }}
                        >
                          距離はグラフ上（計測線の中点）に表示されます
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
              <ResultTab
                cloud={cloud}
                viewMode={viewMode}
                history={cloudHistory}
                editingNameIdx={editingNameIdx}
                setEditingNameIdx={setEditingNameIdx}
                editingNameValue={editingNameValue}
                setEditingNameValue={setEditingNameValue}
                renameEntry={renameEntry}
                setDeleteConfirmIdx={setDeleteConfirmIdx}
                onRestore={(c) => {
                  setShowSlice(false);
                  setCloud(c);
                  setShowPlot(true);
                }}
              />
            )}

            <div style={{ flexGrow: 1 }} />

            {/* 処理経過時間 / 処理時間 */}
            {(status === "RUNNING" || status === "COMPLETE") && (
              <div
                style={{
                  textAlign: "center",
                  fontSize: "13px",
                  color: colors.text,
                  opacity: 0.85,
                  marginBottom: "6px",
                }}
              >
                {status === "RUNNING" ? "経過時間" : "処理時間"}: {formatElapsed(elapsedMs)}
              </div>
            )}

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
                <>
                  AI推論を実行しますか？
                  <div
                    style={{
                      marginTop: "12px",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <span style={{ fontSize: "13px", whiteSpace: "nowrap" }}>モデル:</span>
                    <select
                      value={aiModelType}
                      onChange={(e) => setAiModelType(e.target.value as AiModelType)}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        borderRadius: "6px",
                        border: `1px solid ${colors.border}`,
                        backgroundColor: colors.bgDark,
                        color: colors.text,
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      <option value="resnet50">U-Net++ (ResNet50)</option>
                    </select>
                  </div>
                </>
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
                  if (deleteConfirmIdx !== null) removeEntry(deleteConfirmIdx);
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
