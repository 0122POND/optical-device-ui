import { useEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { downloadCSV, downloadPointCSV, isPointCSV, parseCSV, parsePointCSV } from "./utils/csv";
import {
  buildPointCloudFromFolder,
  densePointsFromGrid,
  sampledPointsFromGrid,
  samplePointCloud,
  type PointCloud,
} from "./utils/pointCloud";
import { useWebSocket, type ApplyCloudOpts } from "./hooks/useWebSocket";
import { usePersistentState } from "./hooks/usePersistentState";
import {
  deviceFlipRef,
  gridScale,
  parsePitchFromFilename,
  physicalGrid,
  pitchFilename,
  pointsInCsvUnits,
  type DataSource,
  type ScaleInputs,
} from "./utils/units";
import { useElapsedTimer } from "./hooks/useElapsedTimer";
import { useCloudHistory } from "./hooks/useCloudHistory";
import {
  DEFAULT_UM_PER_PIXEL_X,
  DEFAULT_UM_PER_PIXEL_Y,
  DIM_COLORS,
  CSV_MAX_TOTAL_POINTS,
  colors,
  fontFamily,
  monoFont,
} from "./utils/constants";
import { formatElapsed } from "./utils/format";
import { Header } from "./components/Header";
import { SettingsTab } from "./components/SettingsTab";
import { ResultTab } from "./components/ResultTab";
import { useSlicePlot } from "./hooks/useSlicePlot";
import { usePlotly } from "./hooks/usePlotly";
import { usePlotlyAutoRotate } from "./hooks/usePlotlyAutoRotate";
import { useWakeLock } from "./hooks/useWakeLock";
import { ThreePointCloudView } from "./components/ThreePointCloudView";
import { ThreeSurfaceMeshView } from "./components/ThreeSurfaceMeshView";
import { Icon } from "./components/Icon";
import {
  buttonPrimaryStyle,
  buttonSecondaryStyle,
  buttonFileStyle,
  enabledStateStyle,
  rowLabelStyle,
  settingRowStyle,
  floatingGroupStyle,
  iconButtonStyle,
  modalButtonStyle,
  modalCardStyle,
  modalOverlayStyle,
  panelSectionStyle,
  sectionTitleStyle,
  segmentButtonStyle,
  segmentGroupStyle,
  toolButtonStyle,
} from "./utils/styles";
import type {
  PlotType,
  HistorySource,
  MeasureStatus,
  ViewMode,
  MeasureState,
  DimLine,
  CloudHistoryEntry,
  DataOrigin,
  FolderSource,
} from "./types";
import "./App.css";

function App() {
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
    "coin" | "coin2" | "coin_paper" | "tgv" | "elec" | "medical" | "semi"
  >("coin");

  // 3Dグラフを表示するかどうか
  const [showPlot, setShowPlot] = useState(false);

  // 断層グラフを表示するかどうか
  const [showSlice, setShowSlice] = useState(false);

  // 断層ライン始点・終点（2クリックで決定）
  const [sliceLineStart, setSliceLineStart] = useState<{ y: number; z: number } | null>(null);
  const [sliceLineEnd, setSliceLineEnd] = useState<{ y: number; z: number } | null>(null);
  // 断層グラフ上での2点間距離計測（t=距離[µm], d=深さ[µm]）
  // sliceMeasureMode: ボタンで有効化したときだけクリックで2点を選べる
  const [sliceMeasureMode, setSliceMeasureMode] = useState(false);
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

  // 掃引間隔の入力値（単位は µm 固定）
  // 設定値はブラウザに保存し、リロードしても残す
  const [sweepInterval, setSweepInterval] = usePersistentState("sweepInterval", "100");
  // ヒートマップのカラーレンジ手動指定（µm, 空文字=自動）。範囲外はグレー表示
  const [colorRangeMin, setColorRangeMin] = usePersistentState("colorRangeMin", "");
  const [colorRangeMax, setColorRangeMax] = usePersistentState("colorRangeMax", "");
  // X/Y軸 µm/pix 換算係数（可変設定）
  const [umPerPixelXInput, setUmPerPixelXInput] = usePersistentState(
    "umPerPixelX",
    String(DEFAULT_UM_PER_PIXEL_X)
  );
  const [umPerPixelYInput, setUmPerPixelYInput] = usePersistentState(
    "umPerPixelY",
    String(DEFAULT_UM_PER_PIXEL_Y)
  );
  // CSV（高さマップ）の列・行ピッチ µm/px。CSV は装置ごとにピッチが違うため個別に持つ
  const [csvPitchXInput, setCsvPitchXInput] = usePersistentState("csvPitchX", "10");
  const [csvPitchYInput, setCsvPitchYInput] = usePersistentState("csvPitchY", "10");
  const umPerPixelX = (() => {
    const v = parseFloat(umPerPixelXInput);
    return !isNaN(v) && v > 0 ? v : DEFAULT_UM_PER_PIXEL_X;
  })();
  const umPerPixelY = (() => {
    const v = parseFloat(umPerPixelYInput);
    return !isNaN(v) && v > 0 ? v : DEFAULT_UM_PER_PIXEL_Y;
  })();

  const csvPitchX = (() => {
    const v = parseFloat(csvPitchXInput);
    return !isNaN(v) && v > 0 ? v : 10;
  })();
  const csvPitchY = (() => {
    const v = parseFloat(csvPitchYInput);
    return !isNaN(v) && v > 0 ? v : 10;
  })();
  // µm 換算の設定一式（描画 effect の依存に入るので参照を安定させる）
  const scale = useMemo<ScaleInputs>(
    () => ({ umPerPixelX, umPerPixelY, sweepInterval, csvPitchX, csvPitchY }),
    [umPerPixelX, umPerPixelY, sweepInterval, csvPitchX, csvPitchY]
  );

  const [zData, setZData] = useState<(number | null)[][] | null>(null);
  // 表示中データの出どころ（device=重心px / csv=高さµm）。読込経路で明示し、換算はこれだけを根拠にする
  const [dataSource, setDataSource] = useState<DataSource>("device");
  // 表示中データの名前（ヘッダーに出す。CSV読込=ファイル名、マスク読込=フォルダ名）
  const [dataName, setDataName] = useState<string | null>(null);
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  // デバイスデータの左右反転の基準値（全表示で共通。表示ごとに別の最大値を使うと深さがずれる）
  const flipRef = useMemo(
    () => (dataSource === "device" ? deviceFlipRef(zData, cloud) : 0),
    [dataSource, zData, cloud]
  );

  // 点群エンジン: "plotly"(既定/最大12万点) or "three"(高密度) の切替と three用高密度クラウド
  const [pointEngine, setPointEngine] = useState<"plotly" | "three">("plotly");
  // Surface エンジン: "plotly"(既定) or "three"(CAD風メッシュ、3D表示のときのみ)
  const [surfaceEngine, setSurfaceEngine] = useState<"plotly" | "three">("plotly");
  // 自動回転（表示中の Surface / 点群をターンテーブルのように水平周回）
  const [autoRotate, setAutoRotate] = useState(false);
  const [threeCloud, setThreeCloud] = useState<PointCloud | null>(null);
  const [isBuildingThree, setIsBuildingThree] = useState(false);
  // three用に高密度クラウドを再生成するためのソースを保持（フォルダ or CSVグリッド）
  // 表示中データの元（three.js 高密度点群の再生成と、CSV 書き出しの形式の判定に使う）
  const [dataOrigin, setDataOrigin] = useState<DataOrigin>(null);

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
    ctx.fillStyle = colors.plotBg;
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
    opts: ApplyCloudOpts
  ) => {
    setCloud(newCloud);
    setZData(grid);
    setDataSource(opts.dataSource);
    setDataName(opts.dataName ?? null);
    setPlotType(opts.plotType);
    // three.js 高密度点群の再生成元を、表示データと必ず一緒に更新する
    // （以前は WebSocket 経路で更新されず、計測後も前の CSV が three に出ていた）
    setDataOrigin(opts.origin);
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
      grid,
      plotType: opts.plotType,
      dataSource: opts.dataSource,
      dataName: opts.dataName ?? null,
      origin: opts.origin,
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

  // サイドパネルの表示/非表示（非表示にするとグラフが全幅表示になる）
  const [sidePanelVisible, setSidePanelVisible] = useState(true);

  // ドラッグモード（pan / turntable / orbit）
  type DragMode = "pan" | "turntable" | "orbit";
  const [dragMode, setDragMode] = useState<DragMode>("turntable");

  // アルゴリズム選択アコーディオンの開閉
  const [showAlgorithms, setShowAlgorithms] = useState(false);
  useEffect(() => {
    if (!showAlgorithms) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAlgorithms(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAlgorithms]);

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

    // showSlice・サイドパネル開閉でコンテナサイズが変わるので、少し遅延してリサイズ。
    // Plotly.Plots.resize(el) はコンテナ拡大に追従しないことがあるため、
    // Plotly の responsive 機構が確実に拾う window の resize イベントも発火する
    const timer = setTimeout(() => {
      requestAnimationFrame(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Plotly.Plots.resize(el as any);
        window.dispatchEvent(new Event("resize"));
      });
    }, 50);

    return () => clearTimeout(timer);
  }, [showPlot, showSlice, sidePanelVisible]);

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
    renderPointsWithThree: pointEngine === "three",
    renderSurfaceWithThree: surfaceEngine === "three",
    cloud,
    flipX,
    viewMode,
    showSlice,
    sliceLineStart,
    sliceLineEnd,
    dataSource,
    scale,
    flipRef,
    colorRangeMin,
    colorRangeMax,
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

  // 自動回転中は画面をスリープさせない（Plotly / three.js どちらの回転でも有効）
  useWakeLock(autoRotate);

  // --- Plotly表示（Surface / Plotly点群）の自動回転。three.js表示中はthree側が回す ---
  usePlotlyAutoRotate({
    plotRef,
    active:
      autoRotate &&
      showPlot &&
      viewMode === "3D" &&
      !(plotType === "scatter3d" && pointEngine === "three") &&
      !(plotType === "surface" && surfaceEngine === "three"),
  });

  // --- 2D 断層グラフ描画（sliceRef へ） ---
  useSlicePlot({
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
    sliceMeasureMode,
    sliceMeasureStart,
    sliceMeasureEnd,
    setSliceMeasureStart,
    setSliceMeasureEnd,
  });

  // 表示データ・単位・反転が変わったら、距離計測の点・寸法線・断面線を消す。
  // これらは µm 座標で持っているため、前提が変わると古い数値を出し続けてしまう
  useEffect(() => {
    // 前提変更時の即時リセットのみ（外部同期ではないが、派生 state にすると計測操作と競合する）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMeasurePt1(null);
    setMeasurePt2(null);
    measureStateRef.current = { ...measureStateRef.current, pt1: null, pt2: null };
    dimLinesRef.current = [];
    setDimReadouts([]);
    setDimLineVersion((v) => v + 1);
    setSliceLineStart(null);
    setSliceLineEnd(null);
  }, [zData, cloud, dataSource, scale, flipX]);

  // 断面線の選び直し・断層非表示・計測モードOFF時は、距離計測をクリアする
  useEffect(() => {
    setSliceMeasureStart(null);
    setSliceMeasureEnd(null);
  }, [sliceLineStart, sliceLineEnd, showSlice, sliceMeasureMode]);

  // 断層を閉じたら計測モードも解除
  useEffect(() => {
    if (!showSlice) setSliceMeasureMode(false);
  }, [showSlice]);

  // 点群形式で書き出すべき点（点群形式CSV由来 / 複数層のマスク）。高さマップで書けるなら null
  const exportPoints = (): PointCloud | null =>
    dataOrigin?.kind === "csvPoints"
      ? dataOrigin.points
      : dataOrigin?.kind === "folder" && dataOrigin.layers
        ? dataOrigin.layers
        : null;
  const canExport = exportPoints() !== null || (!!zData && zData.length > 0);

  // WebSocket が開くのを待ってから送信する。バックエンドが起動していないと永遠に待ち続けて
  // スピナーが止まらなかったため、一定時間で諦めてエラーにする
  const WS_CONNECT_TIMEOUT_MS = 5000;
  const sendWhenOpen = (ws: WebSocket, payload: object, onTimeout: () => void) => {
    const startedAt = Date.now();
    const trySend = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      } else if (
        ws.readyState === WebSocket.CLOSED ||
        Date.now() - startedAt > WS_CONNECT_TIMEOUT_MS
      ) {
        onTimeout();
      } else {
        setTimeout(trySend, 100);
      }
    };
    trySend();
  };
  const backendUnreachable = (kind: "ai" | "acquire") => {
    if (kind === "ai") setIsLoadingAI(false);
    else setIsAcquiring(false);
    setStatus("READY");
    setShowPlot(false);
    alert(
      `バックエンドに接続できませんでした（ws://${window.location.hostname}:8000）。\n` +
        "backend で uvicorn app:app が起動しているか確認してください。"
    );
  };

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

      sendWhenOpen(
        ws,
        {
          cmd: "preprocess",
          params: {
            peak_threshold: 10,
            use_gpu: useGpu,
            algorithm: algorithm,
          },
        },
        () => backendUnreachable("acquire")
      );
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

      sendWhenOpen(ws, { cmd: "ai_inference", params: { model_type: aiModelType } }, () =>
        backendUnreachable("ai")
      );
    } else if (confirmMode === "csv") {
      // 表示と同じ µm の高さ（左右反転も反映）を書き出し、ピッチはファイル名に残す。
      // 高さマップで表せないデータ（点群形式CSV・複数層のマスク）は点群形式（x,y,z）で書き出す。
      // データが無いときは書き出さない（以前はデモ用の偽データを黙って出力していた）
      const sc = gridScale(dataSource, scale);
      const pointSrc = exportPoints();
      if (pointSrc) {
        await downloadPointCSV(
          pointsInCsvUnits(pointSrc, dataSource, scale, flipX, flipRef),
          pitchFilename(`${(dataName ?? "points").replace(/\.csv$/i, "")}_points`, sc.col, sc.row)
        );
      } else if (zData && zData.length > 0) {
        const pg = physicalGrid(zData, dataSource, scale, flipX, flipRef);
        await downloadCSV(pg.z, pitchFilename(dataName ?? "surface", sc.col, sc.row));
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
  const loadCsvText = (
    text: string,
    source: HistorySource = "csv",
    fileName: string | null = null
  ) => {
    // このアプリが書き出した CSV はファイル名にピッチが入っているので、自動で反映する
    const pitch = fileName ? parsePitchFromFilename(fileName) : null;
    if (pitch) {
      setCsvPitchXInput(String(pitch.x));
      setCsvPitchYInput(String(pitch.y));
    }
    // 点群形式（x,y,z ヘッダ＋1行1点）。同じ位置に複数の高さを持てるので高さマップは作らず、
    // Surface・2D寸法測定などグリッド前提の機能は zData 無しとして自動的に無効になる
    if (isPointCSV(text)) {
      const points = parsePointCSV(text);
      if (points.x.length === 0) {
        alert("有効なデータがありません");
        return;
      }
      setShowSlice(false);
      setShowPlot(true);
      applyCloudResult(samplePointCloud(points, CSV_MAX_TOTAL_POINTS), null, {
        plotType: "scatter3d",
        source,
        dataSource: "csv",
        origin: { kind: "csvPoints", points },
        dataName: fileName,
      });
      return;
    }
    const grid = parseCSV(text);
    if (grid.length === 0) {
      alert("CSVデータが空です");
      return;
    }
    // 展開とランダム間引き（reservoir sampling、上限 CSV_MAX_TOTAL_POINTS 件）
    const newCloud = sampledPointsFromGrid(grid, CSV_MAX_TOTAL_POINTS);
    if (newCloud.x.length === 0) {
      alert("有効なデータがありません");
      return;
    }
    setShowSlice(false);
    setShowPlot(true);
    applyCloudResult(newCloud, grid, {
      plotType: "surface",
      source,
      dataSource: "csv",
      origin: { kind: "csv", grid },
      dataName: fileName,
    });
  };

  // CSV読み込み処理
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      loadCsvText(reader.result as string, "csv", file.name);
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
      const src: FolderSource = {
        folderUrl: "/data/mask_result",
        threshold: 128,
        samplePerSlice: 4000,
        flipZ: false,
        colorMode: "z",
        ...(algorithm === "tgv" ? { maxTotalPoints: 250_000 } : {}),
      };
      const { cloud: newCloud, grid: newGrid, layers } = await buildPointCloudFromFolder(src);

      applyCloudResult(newCloud, newGrid, {
        plotType: "surface",
        source: "coin",
        dataSource: "device",
        origin: { kind: "folder", src, layers },
        dataName: "mask_result",
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

  // プロット非表示・2D表示に切り替えたら自動回転を解除する
  useEffect(() => {
    if (!showPlot || viewMode === "2D-camera") {
      setAutoRotate(false);
    }
  }, [showPlot, viewMode]);

  // three.js エンジン選択時、フォルダ由来の点群を高密度(最大100万点)で再生成する。
  // Plotly 用の cloud(最大12万点) はそのまま残し、three にだけ高密度版を渡す。
  useEffect(() => {
    if (pointEngine !== "three" || plotType !== "scatter3d") return;

    // CSV由来: グリッドから高密度点群を同期生成
    if (dataOrigin?.kind === "csv") {
      // 元データの切替に合わせた即時差し替え（フォルダ由来の非同期取得と同じ state に揃える）
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setThreeCloud(densePointsFromGrid(dataOrigin.grid));
      return;
    }

    // 点群形式CSV由来: 全点から最大200万点で生成
    if (dataOrigin?.kind === "csvPoints") {
      setThreeCloud(samplePointCloud(dataOrigin.points, 2_000_000));
      return;
    }

    // フォルダ由来: 最大100万点で再取得
    if (dataOrigin?.kind !== "folder") {
      // それ以外は再生成できないので既存 cloud を流用
      setThreeCloud(cloud);
      return;
    }
    const src = dataOrigin.src;
    let cancelled = false;
    setIsBuildingThree(true);
    buildPointCloudFromFolder({ ...src, maxTotalPoints: 1_000_000 })
      .then((r) => {
        if (!cancelled) setThreeCloud(r.cloud);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setThreeCloud(cloud);
      })
      .finally(() => {
        if (!cancelled) setIsBuildingThree(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pointEngine, plotType, cloud, dataOrigin]);

  // three.js メッシュ用の高さ[µm]グリッドと列/行ピッチ[µm]（Plotly の surface と同じ utils/units の換算）
  const meshSurface = useMemo(() => {
    if (surfaceEngine !== "three" || !zData || zData.length === 0) return null;
    const pg = physicalGrid(zData, dataSource, scale, flipX, flipRef);
    const sc = gridScale(dataSource, scale);
    return { grid: pg.z, pitchX: sc.col, pitchY: sc.row };
  }, [surfaceEngine, zData, dataSource, scale, flipX, flipRef]);

  // --- プロット操作（フローティングツールバーから呼ぶ） ---
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

  const handleCameraReset = () => {
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

  const handleDownload = async () => {
    const el = plotRef.current;
    if (!el) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = el as any;
    // 画面ではプロット背景を透過にしてステージのグラデーションを見せているが、
    // 保存する画像は従来どおり黒背景にする（保存の間だけ背景を塗り、終わったら戻す）
    const bg = (color: string) => ({
      paper_bgcolor: color,
      plot_bgcolor: color,
      ...(p._fullLayout?.scene ? { "scene.bgcolor": color } : {}),
    });
    await Plotly.relayout(el, bg("#000000"));
    try {
      await Plotly.downloadImage(el, {
        format: "png",
        width: 1920,
        height: 1080,
        filename: "surface_plot",
      });
    } finally {
      await Plotly.relayout(el, bg("rgba(0,0,0,0)"));
      // WebGL 3Dプロットのキャンバスが白くなる問題を回避: 再描画
      if (p.data && p.layout) {
        Plotly.react(el, p.data, p.layout);
      }
    }
  };

  // ヘッダーに出す表示中データの概要（名前・グリッドサイズ・有効率）
  const dataSummary = (() => {
    // 点群形式CSV（高さマップなし）は点数を出す
    if ((!zData || zData.length === 0) && dataOrigin?.kind === "csvPoints") {
      return { name: dataName, points: dataOrigin.points.x.length };
    }
    if (!zData || zData.length === 0) return null;
    const h = zData.length;
    const w = zData[0].length;
    let valid = 0;
    for (const row of zData) for (const v of row) if (v != null) valid++;
    return { name: dataName, w, h, validPct: (valid / (w * h)) * 100 };
  })();

  // プロット左下のチップ（描画モード・エンジン・スケール）
  const engineLabel =
    (plotType === "surface" ? surfaceEngine : pointEngine) === "three" ? "three.js" : "Plotly";
  const chip = (children: React.ReactNode) => (
    <span
      style={{
        ...floatingGroupStyle,
        height: "26px",
        padding: "0 10px",
        gap: "6px",
        borderRadius: "7px",
        color: colors.textMuted,
        fontSize: "11.5px",
      }}
    >
      {children}
    </span>
  );
  const chipValue = (v: React.ReactNode) => (
    <b style={{ color: colors.text, fontWeight: 500, fontFamily: monoFont }}>{v}</b>
  );

  const algorithmLabel =
    algorithm === "coin"
      ? "硬貨"
      : algorithm === "coin2"
        ? "硬貨(別アプローチ)"
        : algorithm === "coin_paper"
          ? "論文硬貨"
          : algorithm === "tgv"
            ? "TGV"
            : algorithm === "elec"
              ? "エレキ"
              : algorithm === "medical"
                ? "医療"
                : "半導体";

  return (
    <>
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "grid",
          gridTemplateRows: "52px 1fr",
          backgroundColor: colors.bg,
          color: colors.text,
          fontFamily: fontFamily,
          fontSize: "13px",
          lineHeight: 1.5,
        }}
      >
        {/* ヘッダー */}
        <Header
          lastMeasuredAt={lastMeasuredAt}
          measureCount={measureCount}
          status={status}
          data={dataSummary}
        />

        {/* メインエリア */}
        <div
          style={{
            display: "grid",
            // 左列は minmax(0, 1fr)。素の 1fr は中身の最小幅（Plotlyの描画幅など）より縮まず、
            // 幅の狭い画面でサイドパネルが画面外へ押し出されて横スクロールが出るため
            gridTemplateColumns: sidePanelVisible ? "minmax(0, 1fr) 320px" : "minmax(0, 1fr)",
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* 左：3D Plot + 2D断層 エリア */}
          <div
            style={{
              width: "100%",
              height: "100%",
              minWidth: 0,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              background: `radial-gradient(ellipse at 50% 45%, ${colors.stageGlow} 0%, ${colors.bg} 70%)`,
            }}
          >
            {/* 上：3D（ツールバーはプロットの上に浮かべる。ボタン以外の領域はそのまま操作できる） */}
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
              <div ref={plotRef} style={{ width: "100%", height: "100%", position: "relative" }}>
                {!showPlot && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "14px",
                      color: colors.textMuted,
                      textAlign: "center",
                    }}
                  >
                    <svg
                      width="44"
                      height="44"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={colors.textDim}
                      strokeWidth="1.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2 3 7v10l9 5 9-5V7z" />
                      <path d="M3 7l9 5 9-5M12 12v10" />
                    </svg>
                    <div style={{ fontSize: "15px", fontWeight: 500, color: colors.text }}>
                      3次元形状はまだありません
                    </div>
                    <div style={{ fontSize: "12.5px", lineHeight: 1.7 }}>
                      右側のパネルから計測を開始するか、
                      <br />
                      CSV・マスクを読み込んでください。
                    </div>
                  </div>
                )}

                {/* three.js エンジン: 点群(scatter3d)のとき Plotly の上に高密度描画を重ねる */}
                {pointEngine === "three" && plotType === "scatter3d" && showPlot && (
                  <ThreePointCloudView
                    cloud={threeCloud}
                    dataSource={dataSource}
                    scale={scale}
                    flipX={flipX}
                    flipRef={flipRef}
                    colorRangeMin={colorRangeMin}
                    colorRangeMax={colorRangeMax}
                    isBuilding={isBuildingThree}
                    autoRotate={autoRotate}
                  />
                )}

                {/* three.js エンジン: 3D表示の Surface をCAD風メッシュで描く */}
                {surfaceEngine === "three" &&
                  plotType === "surface" &&
                  viewMode === "3D" &&
                  showPlot &&
                  meshSurface && (
                    <ThreeSurfaceMeshView
                      grid={meshSurface.grid}
                      pitchX={meshSurface.pitchX}
                      pitchY={meshSurface.pitchY}
                      colorRangeMin={colorRangeMin}
                      colorRangeMax={colorRangeMax}
                      autoRotate={autoRotate}
                      onAutoRotateChange={setAutoRotate}
                    />
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
                      backgroundColor: "rgba(11, 14, 19, 0.82)",
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

              {/* 表示情報のチップ（左下） */}
              {showPlot && (
                <div
                  style={{
                    position: "absolute",
                    left: "12px",
                    bottom: "12px",
                    zIndex: 20,
                    display: "flex",
                    gap: "6px",
                    pointerEvents: "none",
                  }}
                >
                  {chip(
                    <>
                      {plotType === "surface" ? "Surface" : "Point Cloud"} ·{" "}
                      {chipValue(engineLabel)}
                    </>
                  )}
                  {/* 表示中データに実際に効いている換算を出す（CSV なら CSV のピッチ） */}
                  {dataSource === "csv" ? (
                    <>
                      {chip(<>CSV</>)}
                      {chip(<>ピッチ {chipValue(`${csvPitchX} × ${csvPitchY} µm/px`)}</>)}
                    </>
                  ) : (
                    <>
                      {chip(<>掃引 {chipValue(sweepInterval ? `${sweepInterval} µm` : "—")}</>)}
                      {chip(
                        <>
                          X {chipValue(umPerPixelX)} · Y {chipValue(`${umPerPixelY} µm/px`)}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* フローティングツールバー（左上） */}
              <div
                style={{
                  position: "absolute",
                  top: "12px",
                  left: "12px",
                  zIndex: 20,
                  display: "flex",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <div style={floatingGroupStyle}>
                  {(
                    [
                      { key: "3D", label: "3D" },
                      { key: "2D-camera", label: "2D" },
                    ] as const
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      className="tt-hover"
                      onClick={() => {
                        setViewMode(key);
                        if (key === "3D") {
                          setShowSlice(false);
                          setDimensionMode(false);
                        }
                      }}
                      style={{ ...segmentButtonStyle(viewMode === key, 30), flex: "none" }}
                    >
                      {key === "3D" ? (
                        <Icon>
                          <path d="M12 2 3 7v10l9 5 9-5V7z" />
                          <path d="M3 7l9 5 9-5M12 12v10" />
                        </Icon>
                      ) : (
                        <Icon>
                          <rect x="4" y="4" width="16" height="16" rx="2" />
                          <path d="M4 12h16M12 4v16" />
                        </Icon>
                      )}
                      {label}
                    </button>
                  ))}
                </div>

                <div style={floatingGroupStyle}>
                  <button
                    title="画像保存"
                    className="tt-hover"
                    style={iconButtonStyle()}
                    onClick={handleDownload}
                  >
                    <Icon>
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-5-5L5 21" />
                    </Icon>
                  </button>
                  <button
                    title="ズームイン"
                    className="tt-hover"
                    style={iconButtonStyle()}
                    onClick={() => handleZoom(0.8)}
                  >
                    <Icon>
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
                    </Icon>
                  </button>
                  <button
                    title="ズームアウト"
                    className="tt-hover"
                    style={iconButtonStyle()}
                    onClick={() => handleZoom(1.25)}
                  >
                    <Icon>
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5M8 11h6" />
                    </Icon>
                  </button>
                  <button
                    title="パン"
                    className="tt-hover"
                    style={iconButtonStyle(dragMode === "pan")}
                    onClick={() => handleDragMode("pan")}
                  >
                    <Icon>
                      <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-3a2 2 0 0 0-4 0" />
                    </Icon>
                  </button>
                  <button
                    title="回転 (Turntable)"
                    className="tt-hover"
                    style={iconButtonStyle(dragMode === "turntable")}
                    onClick={() => handleDragMode("turntable")}
                  >
                    <Icon>
                      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                      <path d="M21 3v5h-5" />
                    </Icon>
                  </button>
                  <button
                    title="回転 (Orbital)"
                    className="tt-hover"
                    style={iconButtonStyle(dragMode === "orbit")}
                    onClick={() => handleDragMode("orbit")}
                  >
                    <Icon>
                      <circle cx="12" cy="12" r="9" />
                      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                    </Icon>
                  </button>
                  <button
                    title="カメラリセット"
                    className="tt-hover"
                    style={iconButtonStyle()}
                    onClick={handleCameraReset}
                  >
                    <Icon>
                      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                      <path d="M3 3v5h5" />
                    </Icon>
                  </button>
                </div>
              </div>

              {/* サイドパネル表示/非表示（右上） */}
              <div
                style={{
                  ...floatingGroupStyle,
                  position: "absolute",
                  top: "12px",
                  right: "12px",
                  zIndex: 20,
                }}
              >
                <button
                  title={
                    sidePanelVisible ? "操作パネルを隠す（グラフを全幅表示）" : "操作パネルを表示"
                  }
                  className="tt-hover"
                  style={iconButtonStyle()}
                  onClick={() => setSidePanelVisible((v) => !v)}
                >
                  <Icon>
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M15 4v16" />
                  </Icon>
                </button>
              </div>
            </div>

            {/* 下：2D 断層グラフ */}
            {showSlice && (
              <div
                style={{
                  height: "260px",
                  flexShrink: 0,
                  position: "relative",
                  borderTop: `1px solid ${colors.border}`,
                }}
              >
                <div ref={sliceRef} style={{ width: "100%", height: "100%" }} />
                {/* 2点間距離計測の操作（ON/OFFトグル＋クリア） */}
                <div
                  style={{
                    position: "absolute",
                    top: "6px",
                    right: "10px",
                    zIndex: 5,
                    display: "flex",
                    gap: "6px",
                  }}
                >
                  {/* 計測中で2点が確定済みのときだけ「クリア」を出す（やり直し用） */}
                  {sliceMeasureMode && sliceMeasureStart && sliceMeasureEnd && (
                    <button
                      onClick={() => {
                        setSliceMeasureStart(null);
                        setSliceMeasureEnd(null);
                      }}
                      style={{
                        padding: "4px 10px",
                        fontSize: "11px",
                        fontWeight: 600,
                        fontFamily,
                        borderRadius: "4px",
                        border: `1px solid ${colors.border}`,
                        backgroundColor: "rgba(22, 27, 34, 0.86)",
                        color: colors.text,
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      クリア
                    </button>
                  )}
                  <button
                    onClick={() => setSliceMeasureMode((v) => !v)}
                    style={{
                      padding: "4px 10px",
                      fontSize: "11px",
                      fontWeight: 600,
                      fontFamily,
                      borderRadius: "4px",
                      border: `1px solid ${sliceMeasureMode ? colors.primary : colors.borderLight}`,
                      backgroundColor: sliceMeasureMode ? colors.primary : "rgba(22, 27, 34, 0.86)",
                      color: sliceMeasureMode ? colors.onPrimary : colors.text,
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {!sliceMeasureMode
                      ? "距離計測"
                      : sliceMeasureStart && sliceMeasureEnd
                        ? "計測中（端点ドラッグで調整）"
                        : "計測中（2点クリック）"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 右：サイドパネル（タブは上に固定、実行ボタンは下に固定、間だけスクロール） */}
          {sidePanelVisible && (
            <div
              style={{
                height: "100%",
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                backgroundColor: colors.surface,
                borderLeft: `1px solid ${colors.border}`,
                boxSizing: "border-box",
              }}
            >
              {/* タブヘッダー */}
              <div style={{ padding: "12px 14px 4px" }}>
                <div style={segmentGroupStyle}>
                  {[
                    { key: "settings" as const, label: "設定" },
                    { key: "actions" as const, label: "操作" },
                    { key: "result" as const, label: "測定結果" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      className="tt-hover"
                      onClick={() => setSideTab(key)}
                      style={{ ...segmentButtonStyle(sideTab === key, 30), fontSize: "12.5px" }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* タブ本体（縦解像度が低い環境でも収まるよう、ここだけスクロール） */}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px" }}>
                {/* 設定タブ */}
                {sideTab === "settings" && (
                  <SettingsTab
                    sweepInterval={sweepInterval}
                    setSweepInterval={setSweepInterval}
                    umPerPixelXInput={umPerPixelXInput}
                    setUmPerPixelXInput={setUmPerPixelXInput}
                    umPerPixelYInput={umPerPixelYInput}
                    setUmPerPixelYInput={setUmPerPixelYInput}
                    csvPitchXInput={csvPitchXInput}
                    setCsvPitchXInput={setCsvPitchXInput}
                    csvPitchYInput={csvPitchYInput}
                    setCsvPitchYInput={setCsvPitchYInput}
                    dataSource={zData && zData.length > 0 ? dataSource : null}
                    colorRangeMin={colorRangeMin}
                    setColorRangeMin={setColorRangeMin}
                    colorRangeMax={colorRangeMax}
                    setColorRangeMax={setColorRangeMax}
                  />
                )}

                {/* 操作タブ */}
                {sideTab === "actions" && (
                  <>
                    {/* 計測 */}
                    <section style={panelSectionStyle}>
                      <h3 style={sectionTitleStyle}>計測</h3>
                      {/* アルゴリズム選択（クリックでポップアップ） */}
                      <button
                        className="tt-hover"
                        onClick={() => setShowAlgorithms(true)}
                        title="クリックしてアルゴリズムを変更"
                        style={{
                          ...buttonSecondaryStyle,
                          width: "100%",
                          height: "40px",
                          justifyContent: "flex-start",
                          gap: "10px",
                        }}
                      >
                        <span style={{ color: colors.textMuted, fontSize: "12px" }}>
                          アルゴリズム
                        </span>
                        <span style={{ fontWeight: 500 }}>{algorithmLabel}</span>
                        <span
                          style={{ marginLeft: "auto", color: colors.textDim, display: "flex" }}
                        >
                          <Icon size={14}>
                            <polyline points="9 18 15 12 9 6" />
                          </Icon>
                        </span>
                      </button>

                      {/* CPU / GPU の選択と計測開始 */}
                      <div style={{ ...segmentGroupStyle, marginTop: "8px" }}>
                        {([false, true] as const).map((gpu) => (
                          <button
                            key={gpu ? "gpu" : "cpu"}
                            className="tt-hover"
                            disabled={status === "RUNNING"}
                            onClick={() => setUseGpu(gpu)}
                            style={{
                              ...segmentButtonStyle(useGpu === gpu),
                              fontFamily: monoFont,
                              ...enabledStateStyle(status !== "RUNNING"),
                            }}
                          >
                            {gpu ? "GPU" : "CPU"}
                          </button>
                        ))}
                      </div>
                      <button
                        className="tt-hover-strong"
                        disabled={status === "RUNNING"}
                        style={{
                          ...buttonPrimaryStyle,
                          width: "100%",
                          marginTop: "8px",
                          ...(status === "RUNNING"
                            ? {
                                backgroundColor: colors.secondary,
                                color: colors.textMuted,
                                boxShadow: "none",
                                cursor: "not-allowed",
                              }
                            : {}),
                        }}
                        onClick={() => {
                          setConfirmMode("plot");
                          setShowConfirm(true);
                        }}
                      >
                        {status === "RUNNING" ? (
                          "処理中..."
                        ) : (
                          <>
                            <Icon size={14} color="currentColor">
                              <path d="M7 5v14l11-7z" fill="currentColor" stroke="none" />
                            </Icon>
                            計測開始
                          </>
                        )}
                      </button>

                      {/* AI推論で表示 */}
                      <button
                        className="tt-hover"
                        disabled={status === "RUNNING" || isLoadingAI}
                        style={{
                          ...buttonSecondaryStyle,
                          width: "100%",
                          marginTop: "8px",
                          ...enabledStateStyle(!(status === "RUNNING" || isLoadingAI)),
                        }}
                        onClick={handleShowAIResult}
                        title="AI推論でマスク画像から3次元形状を再構成して表示する"
                      >
                        <span style={{ color: colors.textMuted, display: "flex" }}>
                          <Icon>
                            <circle cx="5" cy="6" r="2" />
                            <circle cx="19" cy="6" r="2" />
                            <circle cx="5" cy="18" r="2" />
                            <circle cx="19" cy="18" r="2" />
                            <circle cx="12" cy="12" r="2.5" />
                            <line x1="7" y1="7" x2="10" y2="10" />
                            <line x1="14" y1="10" x2="17" y2="7" />
                            <line x1="7" y1="17" x2="10" y2="14" />
                            <line x1="14" y1="14" x2="17" y2="17" />
                          </Icon>
                        </span>
                        {isLoadingAI ? "読込中..." : "AI計測"}
                      </button>
                    </section>

                    {/* ファイル */}
                    <section style={panelSectionStyle}>
                      <h3 style={sectionTitleStyle}>ファイル</h3>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: "6px",
                        }}
                      >
                        <input
                          ref={csvInputRef}
                          type="file"
                          accept=".csv"
                          style={{ display: "none" }}
                          onChange={handleImportCSV}
                        />
                        <button
                          className="tt-hover"
                          style={buttonFileStyle}
                          onClick={() => csvInputRef.current?.click()}
                        >
                          <Icon size={15} color={colors.textMuted}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </Icon>
                          CSV読込
                        </button>
                        <button
                          className="tt-hover"
                          disabled={status === "RUNNING" || isLoadingMask}
                          style={{
                            ...buttonFileStyle,
                            ...enabledStateStyle(!(status === "RUNNING" || isLoadingMask)),
                          }}
                          onClick={handleLoadMask}
                        >
                          <Icon size={15} color={colors.textMuted}>
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                            <line x1="12" y1="11" x2="12" y2="17" />
                            <line x1="9" y1="14" x2="15" y2="14" />
                          </Icon>
                          {isLoadingMask ? "読込中..." : "マスク"}
                        </button>
                        <button
                          className="tt-hover"
                          disabled={!canExport}
                          title={
                            !canExport
                              ? "書き出せるデータがありません"
                              : exportPoints()
                                ? "点群形式（x,y,z・高さ µm）で書き出す（ピッチはファイル名に記録）"
                                : "表示中の高さマップを µm で書き出す（ピッチはファイル名に記録）"
                          }
                          style={{
                            ...buttonFileStyle,
                            ...enabledStateStyle(canExport),
                          }}
                          onClick={() => {
                            setConfirmMode("csv");
                            setShowConfirm(true);
                          }}
                        >
                          <Icon size={15} color={colors.textMuted}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </Icon>
                          CSV出力
                        </button>
                      </div>
                    </section>

                    {/* 表示 */}
                    <section style={panelSectionStyle}>
                      <h3 style={sectionTitleStyle}>表示</h3>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: "6px",
                        }}
                      >
                        {/* 軸 */}
                        <button
                          className="tt-hover"
                          disabled={!showPlot}
                          onClick={() => {
                            if (!showPlot) return;
                            setAxisVisible((v) => !v);
                          }}
                          style={toolButtonStyle(axisVisible, showPlot)}
                          title={axisVisible ? "軸を非表示にする" : "軸を表示する"}
                        >
                          <Icon size={18}>
                            <line x1="4" y1="20" x2="4" y2="4" />
                            <line x1="4" y1="20" x2="20" y2="20" />
                            <polyline points="4 4 2 6" />
                            <polyline points="4 4 6 6" />
                            <polyline points="20 20 18 18" />
                            <polyline points="20 20 18 22" />
                          </Icon>
                          軸
                        </button>

                        {/* 左右反転 */}
                        <button
                          className="tt-hover"
                          disabled={!showPlot}
                          onClick={() => {
                            if (!showPlot) return;
                            setFlipX((v) => !v);
                          }}
                          style={toolButtonStyle(flipX, showPlot)}
                        >
                          <Icon size={18}>
                            <polyline points="7 8 3 12 7 16" />
                            <polyline points="17 8 21 12 17 16" />
                            <line x1="3" y1="12" x2="10" y2="12" />
                            <line x1="14" y1="12" x2="21" y2="12" />
                            <line x1="12" y1="4" x2="12" y2="20" strokeDasharray="2 2" />
                          </Icon>
                          左右反転
                        </button>

                        {/* 自動回転（表示中の Surface / 点群をそのまま回す） */}
                        <button
                          className="tt-hover"
                          disabled={!cloud && !zData}
                          onClick={() => {
                            if (!cloud && !zData) return;
                            const next = !autoRotate;
                            if (next) {
                              // 3D表示に切り替え、回転と噛み合わない2D系モードを解除
                              //（Surface/Point Cloud の表示タイプは変えずに今の見た目で回す）
                              setViewMode("3D");
                              setShowSlice(false);
                              setDimensionMode(false);
                              setDimReadouts([]);
                            }
                            setAutoRotate(next);
                          }}
                          style={toolButtonStyle(autoRotate, !!(cloud || zData))}
                          title="表示中の3Dグラフ（Surface / 点群）をターンテーブルのように自動回転させる"
                        >
                          <Icon size={18}>
                            <path d="M21 12a9 9 0 1 1-2.6-6.3" />
                            <polyline points="21 2 21 6 17 6" />
                            <ellipse cx="12" cy="12" rx="5" ry="2" />
                          </Icon>
                          自動回転
                        </button>
                      </div>

                      {/* 表示タイプ・エンジン切替 */}
                      {/* 高さマップが無い点群形式CSVでは描画モードは選べず、エンジンだけ切り替える */}
                      {showPlot && ((zData && zData.length > 0) || !!cloud) && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "10px",
                            marginTop: "14px",
                          }}
                        >
                          {zData && zData.length > 0 && (
                            <div style={settingRowStyle}>
                              <span style={rowLabelStyle}>描画モード</span>
                              <div style={{ ...segmentGroupStyle, width: "190px" }}>
                                {(["surface", "scatter3d"] as const).map((pt) => (
                                  <button
                                    key={pt}
                                    className="tt-hover"
                                    onClick={() => setPlotType(pt)}
                                    style={segmentButtonStyle(plotType === pt)}
                                  >
                                    {pt === "surface" ? "Surface" : "Point Cloud"}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Surface エンジン切替（Surface のときのみ） */}
                          {plotType === "surface" && (
                            <div style={settingRowStyle}>
                              <span style={rowLabelStyle}>エンジン</span>
                              <div style={{ ...segmentGroupStyle, width: "190px" }}>
                                {(["plotly", "three"] as const).map((eng) => (
                                  <button
                                    key={eng}
                                    className="tt-hover"
                                    onClick={() => setSurfaceEngine(eng)}
                                    style={segmentButtonStyle(surfaceEngine === eng)}
                                  >
                                    {eng === "plotly" ? "Plotly" : "three.js"}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 点群エンジン切替（Point Cloud のときのみ） */}
                          {plotType === "scatter3d" && (
                            <div style={settingRowStyle}>
                              <span style={rowLabelStyle}>エンジン</span>
                              <div style={{ ...segmentGroupStyle, width: "190px" }}>
                                {(["plotly", "three"] as const).map((eng) => (
                                  <button
                                    key={eng}
                                    className="tt-hover"
                                    onClick={() => setPointEngine(eng)}
                                    style={segmentButtonStyle(pointEngine === eng)}
                                    title={
                                      eng === "plotly" ? "最大12万点" : "高密度（最大100万点以上）"
                                    }
                                  >
                                    {eng === "plotly" ? "Plotly" : "three.js"}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </section>

                    {/* 計測ツール */}
                    <section style={{ ...panelSectionStyle, borderBottom: "none" }}>
                      <h3 style={sectionTitleStyle}>計測ツール</h3>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: "6px",
                        }}
                      >
                        {/* 距離計測 */}
                        <button
                          className="tt-hover"
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
                          style={toolButtonStyle(measureMode, showPlot)}
                        >
                          <Icon size={18}>
                            <path d="M2 12h4l1-3h2l2 6h2l1-3h4" />
                            <circle cx="5" cy="12" r="1.5" fill="currentColor" />
                            <circle cx="19" cy="12" r="1.5" fill="currentColor" />
                          </Icon>
                          距離
                        </button>

                        {/* 寸法測定（2D 両矢印ドラッグ） */}
                        <button
                          className="tt-hover"
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
                          style={toolButtonStyle(
                            dimensionMode,
                            viewMode === "2D-camera" && !!zData && zData.length > 0
                          )}
                          title="2D表示で両矢印をドラッグし、任意2点間の寸法を測る"
                        >
                          <Icon size={18}>
                            <line x1="3" y1="12" x2="21" y2="12" />
                            <polyline points="6 9 3 12 6 15" />
                            <polyline points="18 9 21 12 18 15" />
                          </Icon>
                          寸法
                        </button>

                        {/* 断層 出力/停止 */}
                        <button
                          className="tt-hover"
                          disabled={(!cloud && !zData) || viewMode !== "2D-camera"}
                          style={toolButtonStyle(
                            showSlice,
                            !!(cloud || zData) && viewMode === "2D-camera"
                          )}
                          onClick={() => {
                            if ((!cloud && !zData) || viewMode !== "2D-camera") return;
                            setShowSlice((v) => {
                              if (!v) {
                                setSliceLineStart(null);
                                setSliceLineEnd(null);
                                // 競合する他モード（寸法測定・距離計測）を解除
                                setDimensionMode(false);
                                setDimReadouts([]);
                                setMeasureMode(false);
                                measureStateRef.current = { mode: false, pt1: null, pt2: null };
                                setMeasurePt1(null);
                                setMeasurePt2(null);
                              }
                              return !v;
                            });
                          }}
                          title={showSlice ? "断層グラフを閉じる" : "2D表示で断層グラフを出す"}
                        >
                          <Icon size={18}>
                            <rect x="2" y="6" width="20" height="12" rx="2" />
                            <line x1="2" y1="12" x2="22" y2="12" />
                          </Icon>
                          断層
                        </button>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          marginTop: "10px",
                        }}
                      >
                        {/* 寸法読み取り値（線ごと） */}
                        {dimensionMode && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button
                                onClick={addDimLine}
                                style={{
                                  ...buttonFileStyle,
                                  flex: 1,
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
                                    borderRadius: "8px",
                                    backgroundColor: colors.bgDark,
                                    border: `1px solid ${color}`,
                                    fontSize: "12px",
                                    color: colors.text,
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
                                        color: colors.textDim,
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
                                  <div style={{ color: colors.textMuted }}>
                                    ΔX: {r.dx.toFixed(1)} {r.unit} ／ ΔY: {r.dy.toFixed(1)} {r.unit}
                                  </div>
                                </div>
                              );
                            })}
                            <div style={{ color: colors.textDim, fontSize: "11px" }}>
                              矢印の端点をドラッグして測りたい2点に合わせてください。Shiftを押しながらドラッグすると水平/垂直に固定できます。数値ボックスはドラッグで自由に移動できます
                            </div>
                          </div>
                        )}

                        {/* 距離計測結果 */}
                        {measureMode && (
                          <div
                            style={{
                              padding: "10px",
                              borderRadius: "8px",
                              backgroundColor: colors.bgDark,
                              border: `1px solid ${colors.border}`,
                              fontSize: "12px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px",
                            }}
                          >
                            <div
                              style={{
                                color: colors.primary,
                                fontWeight: 600,
                                marginBottom: "2px",
                              }}
                            >
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
                                    borderTop: `1px solid ${colors.border}`,
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
                                    border: `1px solid ${colors.border}`,
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
                      </div>
                    </section>
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
                    onRestore={(entry: CloudHistoryEntry) => {
                      // 高さマップ・表示タイプ・出どころまで丸ごと戻す（点群だけ戻すと、
                      // Surface や断面に別の計測の高さマップが出ていた）
                      setShowSlice(false);
                      setCloud(entry.cloud);
                      setZData(entry.grid);
                      setPlotType(entry.plotType);
                      setDataSource(entry.dataSource);
                      setDataName(entry.dataName);
                      setDataOrigin(entry.origin);
                      setShowPlot(true);
                    }}
                  />
                )}
              </div>

              {/* 処理時間（タブに関係なく常時表示） */}
              <div style={{ padding: "10px 16px", borderTop: `1px solid ${colors.border}` }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "11.5px",
                    color: colors.textDim,
                  }}
                >
                  <span>{status === "RUNNING" ? "経過時間" : "処理時間"}</span>
                  <span style={{ fontFamily: monoFont, color: colors.textMuted }}>
                    {formatElapsed(elapsedMs)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* アルゴリズム選択ポップアップ */}
      {showAlgorithms && (
        <div style={modalOverlayStyle} onClick={() => setShowAlgorithms(false)}>
          <div style={{ ...modalCardStyle, width: "380px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: "15px", fontWeight: 600, marginBottom: "4px" }}>
              アルゴリズムを選択
            </div>
            <div style={{ fontSize: "12px", color: colors.textDim, marginBottom: "16px" }}>
              現在は「硬貨」「論文硬貨」が選択できます
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
              }}
            >
              {(["coin", "coin2", "coin_paper", "tgv", "elec", "medical", "semi"] as const).map(
                (alg) => {
                  const label =
                    alg === "coin"
                      ? "硬貨"
                      : alg === "coin2"
                        ? "硬貨(別アプローチ)"
                        : alg === "coin_paper"
                          ? "論文硬貨"
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
                    ) : alg === "coin_paper" ? (
                      <>
                        <circle cx="9" cy="12" r="7" />
                        <path d="M15 5h6v14h-6" />
                        <line x1="17" y1="9" x2="19" y2="9" />
                        <line x1="17" y1="12" x2="19" y2="12" />
                        <line x1="17" y1="15" x2="19" y2="15" />
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
                  const disabled = alg !== "coin" && alg !== "coin_paper";
                  return (
                    <button
                      key={alg}
                      onClick={() => {
                        if (disabled) return;
                        setAlgorithm(alg);
                        setShowAlgorithms(false);
                      }}
                      disabled={disabled}
                      title={disabled ? "現在は「硬貨」のみ選択可能です" : ""}
                      className="tt-hover"
                      style={{
                        height: "44px",
                        borderRadius: "8px",
                        border: `1px solid ${algorithm === alg ? colors.primary + "80" : colors.border}`,
                        backgroundColor: algorithm === alg ? colors.primarySoft : "transparent",
                        color: algorithm === alg ? colors.primary : colors.text,
                        fontSize: "12px",
                        fontWeight: algorithm === alg ? 600 : 500,
                        fontFamily: fontFamily,
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.45 : 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
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
                }
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "18px" }}>
              <button
                className="tt-hover"
                style={modalButtonStyle("neutral")}
                onClick={() => setShowAlgorithms(false)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 確認モーダル */}
      {showConfirm && confirmMode && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalCardStyle, width: "340px" }}>
            <div
              style={{
                fontSize: "15px",
                marginBottom: "20px",
                fontWeight: 500,
                lineHeight: 1.6,
              }}
            >
              {confirmMode === "csv" ? (
                exportPoints() ? (
                  <>
                    csvファイルを出力しますか？
                    <div style={{ marginTop: "8px", fontSize: "12.5px", color: colors.textMuted }}>
                      {dataOrigin?.kind === "csvPoints"
                        ? "点群形式（x,y,z）で出力します。"
                        : "同じ位置に縞が複数ある（複数層の）データのため、層ごとの点を点群形式（x,y,z）で出力します。"}
                    </div>
                  </>
                ) : (
                  "csvファイルを出力しますか？"
                )
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
                        borderRadius: "8px",
                        border: `1px solid ${colors.borderLight}`,
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
                            : algorithm === "coin_paper"
                              ? "論文硬貨"
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
                className="tt-hover"
                style={modalButtonStyle("neutral")}
                onClick={handleConfirmCancel}
              >
                いいえ
              </button>
              <button
                className="tt-hover-strong"
                style={modalButtonStyle("primary")}
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
          style={{ ...modalOverlayStyle, zIndex: 10000 }}
          onClick={() => setDeleteConfirmIdx(null)}
        >
          <div
            style={{ ...modalCardStyle, minWidth: "300px", textAlign: "center" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ margin: "0 0 16px", fontSize: "14px", color: colors.text }}>
              この測定履歴を削除しますか？
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
              <button
                className="tt-hover"
                style={modalButtonStyle("neutral")}
                onClick={() => setDeleteConfirmIdx(null)}
              >
                キャンセル
              </button>
              <button
                className="tt-hover-strong"
                style={modalButtonStyle("danger")}
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
