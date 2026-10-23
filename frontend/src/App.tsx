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
import {
  deviceFlipRef,
  gridScale,
  parsePitchFromFilename,
  physicalGrid,
  parseHeightUnitFromFilename,
  pitchFilename,
  pointsInCsvUnits,
  type DataSource,
} from "./utils/units";
import { useElapsedTimer } from "./hooks/useElapsedTimer";
import { useCloudHistory, type HistoryItem } from "./hooks/useCloudHistory";
import { CSV_MAX_TOTAL_POINTS, colors, fontFamily, monoFont } from "./utils/constants";
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
  floatingGroupStyle,
  iconButtonStyle,
  segmentButtonStyle,
  segmentGroupStyle,
} from "./utils/styles";
import type {
  PlotType,
  HistorySource,
  MeasureStatus,
  ViewMode,
  MeasureState,
  DimLine,
  DataOrigin,
  FolderSource,
  ProcessingInfo,
} from "./types";
import { postActive, POST_OFF } from "./utils/postprocess";
import { ProgressOverlay } from "./components/ProgressOverlay";
import { DeleteHistoryModal } from "./components/modals/DeleteHistoryModal";
import { ConfirmModal } from "./components/modals/ConfirmModal";
import { AlgorithmModal } from "./components/modals/AlgorithmModal";
import { MeasureToolsSection } from "./components/operate/MeasureToolsSection";
import { DisplaySection } from "./components/operate/DisplaySection";
import { PostprocessSection } from "./components/operate/PostprocessSection";
import { FileSection } from "./components/operate/FileSection";
import { MeasureSection } from "./components/operate/MeasureSection";
import { SlicePanel } from "./components/SlicePanel";
import { PlotToolbar } from "./components/plot/PlotToolbar";
import { PlotInfoChips } from "./components/plot/PlotInfoChips";
import { generateThumbnail } from "./utils/thumbnail";
import { useScaleSettings } from "./hooks/useScaleSettings";
import { usePostprocess } from "./hooks/usePostprocess";
import { usePlotControls } from "./hooks/usePlotControls";
import "./App.css";

// AI推論のモデル（学習済みで使えるのはこの1つ。backend/ai_inference.py の MODEL_CONFIGS のキー）
const AI_MODEL_TYPE = "resnet50";

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
  const [confirmMode, setConfirmMode] = useState<"plot" | "ai" | null>(null);

  // GPU使用フラグ（STARTボタンで選択）
  const [useGpu, setUseGpu] = useState(false);
  const [algorithm, setAlgorithm] = useState<
    "coin" | "coin2" | "coin_paper" | "tgv" | "elec" | "medical" | "semi"
  >("coin");

  // 3Dグラフを表示するかどうか
  const [showPlot, setShowPlot] = useState(false);

  // 断層グラフを表示するかどうか
  const [showSlice, setShowSlice] = useState(false);
  // 断面の帯の幅[µm]（0=線の上だけ）。帯なら幅の中の画素の中央値で断面を描く
  const [sliceBandUm, setSliceBandUm] = useState(0);

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

  // 単位換算・色レンジ・奥行きの強調の設定
  const {
    sweepInterval,
    setSweepInterval,
    colorRangeMin,
    setColorRangeMin,
    colorRangeMax,
    setColorRangeMax,
    umPerPixelXInput,
    setUmPerPixelXInput,
    umPerPixelYInput,
    setUmPerPixelYInput,
    csvPitchXInput,
    setCsvPitchXInput,
    csvPitchYInput,
    setCsvPitchYInput,
    setCsvHeightUnit,
    csvUmPerHeightPxInput,
    setCsvUmPerHeightPxInput,
    setDepthExaggerationInput,
    depthExaggeration,
    umPerPixelX,
    umPerPixelY,
    csvPitchX,
    csvPitchY,
    csvHeightUnitValue,
    scale,
  } = useScaleSettings();

  const [zData, setZData] = useState<(number | null)[][] | null>(null);
  // 表示中データの出どころ（device=重心px / csv=高さµm）。読込経路で明示し、換算はこれだけを根拠にする
  const [dataSource, setDataSource] = useState<DataSource>("device");
  // 表示中データの名前（ヘッダーに出す。CSV読込=ファイル名、マスク読込=フォルダ名）
  const [dataName, setDataName] = useState<string | null>(null);
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  // 高さマップの後処理（外れ値除去・走査方向の補間）。新しいデータを開くと切に戻す
  const { post, setPost, showFilled, setShowFilled, postResult, viewZ, filledView } =
    usePostprocess(zData, dataSource, flipX);
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
  // 表示中データの処理条件と深さの求め方（結果タブに表示）
  const [processing, setProcessing] = useState<ProcessingInfo>(null);
  // AI の確率マップから抜き出し直すときのしきい値（null=推論時のマスクのまま）と、点群の色分け
  const [aiThreshold, setAiThreshold] = useState<number | null>(null);
  const [pointColorBy, setPointColorBy] = useState<"depth" | "confidence">("depth");

  // 表示タイプ（scatter3d: 点群 / surface: サーフェス）
  const [plotType, setPlotType] = useState<PlotType>("scatter3d");

  // 測定履歴（最大5件）。データ管理は useCloudHistory に集約、UI状態(編集/削除)は App 保持
  const {
    history: cloudHistory,
    usage: historyUsage,
    pushEntry,
    renameEntry,
    removeEntry,
    clearHistory,
    loadEntry,
  } = useCloudHistory();
  // 表示中の履歴（一覧の「表示中」の印）
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  // 削除確認中の履歴の添字（-1 = すべて削除）
  const [deleteConfirmIdx, setDeleteConfirmIdx] = useState<number | null>(null);
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");

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
    setPost(POST_OFF);
    setDataSource(opts.dataSource);
    setDataName(opts.dataName ?? null);
    setPlotType(opts.plotType);
    // three.js 高密度点群の再生成元を、表示データと必ず一緒に更新する
    // （以前は WebSocket 経路で更新されず、計測後も前の CSV が three に出ていた）
    setDataOrigin(opts.origin);
    setProcessing(opts.processing ?? null);
    setAiThreshold(null);
    setPointColorBy("depth");
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
    const id = pushEntry({
      cloud: newCloud,
      grid,
      plotType: opts.plotType,
      dataSource: opts.dataSource,
      dataName: opts.dataName ?? null,
      origin: opts.origin,
      processing: opts.processing ?? null,
      measuredAt: now,
      points: newCloud.x.length,
      thumbnail: thumb,
      name: opts.name ?? "",
      source: opts.source,
    });
    setCurrentHistoryId(id);
  };
  // WebSocket 接続・onmessage ルーティングは useWebSocket フックへ集約。
  // 完了時の点群反映は applyCloudResult、進捗・状態・エラーはコールバックで App 側へ委譲。
  const { connect, cancel } = useWebSocket({
    algorithm,
    applyCloudResult,
    onProgress: (p) => {
      setProgressStep(p.step);
      setProgressTotal(p.total);
      setProgressMessage(p.message);
      setProgressPercent(p.percent);
    },
    onStatus: (value) => setStatus(value),
    onCancelled: () => {
      setIsLoadingAI(false);
      setIsAcquiring(false);
      setCancelling(false);
      setStatus("READY");
      setProgressMessage("中止しました");
    },
    onError: (kind, msg) => {
      setCancelling(false);
      // generic（サーバーの error 型）は AI 推論中にも届くので、どちらのフラグも下ろす
      // （以前は AI 推論中のサーバーエラーで「AI推論中...」の表示が消えなかった）
      if (kind === "ai" || kind === "generic") setIsLoadingAI(false);
      if (kind === "acquire" || kind === "generic") setIsAcquiring(false);
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
  // 中止ボタンを押してから止まるまで（バックエンドは次の区切りで止まる）
  const [cancelling, setCancelling] = useState(false);

  // AI結果読み込み中フラグ
  const [isLoadingAI, setIsLoadingAI] = useState(false);

  // マスク読込中フラグ
  const [isLoadingMask, setIsLoadingMask] = useState(false);

  // サイドパネルのタブ
  type SideTab = "settings" | "actions" | "result";
  const [sideTab, setSideTab] = useState<SideTab>("actions");

  // サイドパネルの表示/非表示（非表示にするとグラフが全幅表示になる）
  const [sidePanelVisible, setSidePanelVisible] = useState(true);

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

  // --- AI の確率マップ（推論をやり直さずにしきい値を変える・信頼度で色分けする） ---
  // 保存した履歴から戻したもの（snapshot）は確率マップが上書きされうるので使わない
  const aiMeta =
    processing?.meta?.source === "ai_inference" &&
    processing.meta.prob_dir &&
    dataOrigin?.kind === "folder"
      ? processing.meta
      : null;
  const probDir = aiMeta?.prob_dir ?? null;
  const fromProb =
    !!probDir && dataOrigin?.kind === "folder" && dataOrigin.src.folderUrl.endsWith(`/${probDir}`);
  // 信頼度は確率マップから作った点群（c=確率）のときだけ意味を持つ
  const effectivePointColorBy = pointColorBy === "confidence" && fromProb ? "confidence" : "depth";
  // 再抽出 effect から最新の元データを読むための ref（依存に入れると再抽出のたびに再実行されてしまう）
  const aiCtxRef = useRef<{ meta: typeof aiMeta; origin: DataOrigin }>({
    meta: null,
    origin: null,
  });
  useEffect(() => {
    aiCtxRef.current = { meta: aiMeta, origin: dataOrigin };
  });
  useEffect(() => {
    if (aiThreshold == null) return;
    const { meta, origin } = aiCtxRef.current;
    if (!meta?.prob_dir || origin?.kind !== "folder") return;
    let cancelled = false;
    // スライダーを動かしている間は待ち、止まってから抜き出す
    const timer = window.setTimeout(async () => {
      const base = origin.src.folderUrl.replace(new RegExp(`/${meta.prob_dir}$`), "");
      const src: FolderSource = {
        ...origin.src,
        folderUrl: `${base}/${meta.prob_dir}`,
        threshold: Math.round(aiThreshold * 255),
        colorMode: "intensity",
      };
      try {
        // 確率マップは画素値=確率なので、しきい値超えの区間の「輝度加重重心」がそのまま確率加重重心になる
        const r = await buildPointCloudFromFolder(src);
        if (cancelled) return;
        setCloud(r.cloud);
        setZData(r.grid);
        setDataOrigin({ kind: "folder", src, layers: r.layers });
        setProcessing({ meta, depthSource: "prob", threshold: aiThreshold });
      } catch (e) {
        console.error(e);
        if (!cancelled) alert(`確率マップの読み込みに失敗しました: ${(e as Error).message}`);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [aiThreshold]);

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
    depthExaggeration,
    pointColorBy: effectivePointColorBy,
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
    zData: viewZ,
    filledMask: filledView,
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
    zData: viewZ,
    cloud,
    sliceLineStart,
    sliceLineEnd,
    dataSource,
    scale,
    flipX,
    flipRef,
    plotType,
    bandWidthUm: viewZ && viewZ.length > 0 ? sliceBandUm : 0,
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
      : (dataOrigin?.kind === "folder" || dataOrigin?.kind === "snapshot") && dataOrigin.layers
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
      setCancelling(false);

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
      setCancelling(false);

      // 進捗初期化
      setProgressStep(0);
      setProgressTotal(6);
      setProgressMessage("AI推論を開始中...");
      setProgressPercent(0);

      setStatus("RUNNING");

      console.log("AI推論開始...");

      const ws = connect();

      sendWhenOpen(ws, { cmd: "ai_inference", params: { model_type: AI_MODEL_TYPE } }, () =>
        backendUnreachable("ai")
      );
    }

    setShowConfirm(false);
    setConfirmMode(null);
  };

  // CSV出力（保存ダイアログが確認を兼ねるので、確認モーダルは出さない）
  const exportCsv = async () => {
    // 表示と同じ µm の高さ（左右反転も反映）を書き出し、ピッチはファイル名に残す。
    // 高さマップで表せないデータ（点群形式CSV・複数層のマスク）は点群形式（x,y,z）で書き出す。
    // データが無いときは書き出さない（以前はデモ用の偽データを黙って出力していた）
    const sc = gridScale(dataSource, scale);
    // 後処理を掛けているときは、掛けた高さマップを書き出す（ファイル名に処理を残す）
    const pointSrc = postActive(post) ? null : exportPoints();
    if (pointSrc) {
      await downloadPointCSV(
        pointsInCsvUnits(pointSrc, dataSource, scale, flipX, flipRef),
        pitchFilename(
          `${(dataName ?? "points").replace(/\.csv$/i, "")}_points`,
          sc.col,
          sc.row,
          sc.valueUnit
        )
      );
    } else if (viewZ && viewZ.length > 0) {
      const pg = physicalGrid(viewZ, dataSource, scale, flipX, flipRef);
      const base = (dataName ?? "surface").replace(/\.csv$/i, "");
      const tag =
        (post.removeOutliers
          ? `_${post.outlierBase === "global" ? "mad" : "hampel"}${post.sigma}`
          : "") + (post.interpolate ? "_interp" : "");
      await downloadCSV(pg.z, pitchFilename(base + tag, sc.col, sc.row, sc.valueUnit));
    }
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
    // 高さの単位（_zum / _zpx）も書き出し時に残しているので反映する
    const zUnit = fileName ? parseHeightUnitFromFilename(fileName) : null;
    if (zUnit) setCsvHeightUnit(zUnit);
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
      const {
        cloud: newCloud,
        grid: newGrid,
        layers,
        meta,
        depthSource,
      } = await buildPointCloudFromFolder(src);

      applyCloudResult(newCloud, newGrid, {
        plotType: "surface",
        source: "coin",
        dataSource: "device",
        origin: { kind: "folder", src, layers },
        processing: { meta, depthSource },
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
    if (surfaceEngine !== "three" || !viewZ || viewZ.length === 0) return null;
    const pg = physicalGrid(viewZ, dataSource, scale, flipX, flipRef);
    const sc = gridScale(dataSource, scale);
    return { grid: pg.z, pitchX: sc.col, pitchY: sc.row };
  }, [surfaceEngine, viewZ, dataSource, scale, flipX, flipRef]);

  // --- プロット操作（フローティングツールバーから呼ぶ） ---
  const {
    dragMode,
    zoomRequest,
    handleZoom,
    handleDragMode,
    viewPreset,
    handleViewPreset,
    handleCameraReset,
    handleDownload,
  } = usePlotControls({ plotRef, plotType, viewMode, setAutoRotate });

  // ヘッダーに出す表示中データの概要（名前・グリッドサイズ・有効率）
  const dataSummary = (() => {
    // 点群形式CSV（高さマップなし）は点数を出す
    if ((!zData || zData.length === 0) && dataOrigin?.kind === "csvPoints") {
      return { name: dataName, points: dataOrigin.points.x.length };
    }
    if (!viewZ || viewZ.length === 0) return null;
    const h = viewZ.length;
    const w = viewZ[0].length;
    let valid = 0;
    for (const row of viewZ) for (const v of row) if (v != null) valid++;
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
                    depthExaggeration={depthExaggeration}
                    colorBy={effectivePointColorBy}
                    viewPreset={viewPreset}
                    dragMode={dragMode}
                    zoomRequest={zoomRequest}
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
                      filledMask={filledView}
                      heightUnit={gridScale(dataSource, scale).valueUnit}
                      colorRangeMin={colorRangeMin}
                      colorRangeMax={colorRangeMax}
                      autoRotate={autoRotate}
                      onAutoRotateChange={setAutoRotate}
                      viewPreset={viewPreset}
                      dragMode={dragMode}
                      zoomRequest={zoomRequest}
                    />
                  )}

                <ProgressOverlay
                  cancel={cancel}
                  cancelling={cancelling}
                  elapsedMs={elapsedMs}
                  isAcquiring={isAcquiring}
                  isLoadingAI={isLoadingAI}
                  progressMessage={progressMessage}
                  progressPercent={progressPercent}
                  progressStep={progressStep}
                  progressTotal={progressTotal}
                  setCancelling={setCancelling}
                />
              </div>

              {/* 表示情報のチップ（左下） */}
              <PlotInfoChips
                chip={chip}
                chipValue={chipValue}
                csvPitchX={csvPitchX}
                csvPitchY={csvPitchY}
                dataSource={dataSource}
                engineLabel={engineLabel}
                plotType={plotType}
                showPlot={showPlot}
                sweepInterval={sweepInterval}
                umPerPixelX={umPerPixelX}
                umPerPixelY={umPerPixelY}
              />

              {/* フローティングツールバー（左上） */}
              <PlotToolbar
                dragMode={dragMode}
                handleCameraReset={handleCameraReset}
                handleDownload={handleDownload}
                handleDragMode={handleDragMode}
                handleViewPreset={handleViewPreset}
                handleZoom={handleZoom}
                setDimensionMode={setDimensionMode}
                setShowSlice={setShowSlice}
                setViewMode={setViewMode}
                showPlot={showPlot}
                viewMode={viewMode}
              />

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
            <SlicePanel
              setSliceBandUm={setSliceBandUm}
              setSliceMeasureEnd={setSliceMeasureEnd}
              setSliceMeasureMode={setSliceMeasureMode}
              setSliceMeasureStart={setSliceMeasureStart}
              showSlice={showSlice}
              sliceBandUm={sliceBandUm}
              sliceMeasureEnd={sliceMeasureEnd}
              sliceMeasureMode={sliceMeasureMode}
              sliceMeasureStart={sliceMeasureStart}
              sliceRef={sliceRef}
              viewZ={viewZ}
            />
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
                    csvHeightUnit={csvHeightUnitValue}
                    setCsvHeightUnit={setCsvHeightUnit}
                    csvUmPerHeightPxInput={csvUmPerHeightPxInput}
                    setCsvUmPerHeightPxInput={setCsvUmPerHeightPxInput}
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
                    <MeasureSection
                      algorithmLabel={algorithmLabel}
                      handleShowAIResult={handleShowAIResult}
                      isLoadingAI={isLoadingAI}
                      setConfirmMode={setConfirmMode}
                      setShowAlgorithms={setShowAlgorithms}
                      setShowConfirm={setShowConfirm}
                      setUseGpu={setUseGpu}
                      status={status}
                      useGpu={useGpu}
                    />

                    {/* ファイル */}
                    <FileSection
                      canExport={canExport}
                      csvInputRef={csvInputRef}
                      dataOrigin={dataOrigin}
                      exportCsv={exportCsv}
                      exportPoints={exportPoints}
                      handleImportCSV={handleImportCSV}
                      handleLoadMask={handleLoadMask}
                      isLoadingMask={isLoadingMask}
                      status={status}
                    />

                    {/* 後処理（高さマップ。tools/remove_outliers.py・interpolate_scan.py と同じ処理） */}
                    <PostprocessSection
                      post={post}
                      postResult={postResult}
                      setPost={setPost}
                      setShowFilled={setShowFilled}
                      showFilled={showFilled}
                      zData={zData}
                    />

                    {/* 表示 */}
                    <DisplaySection
                      aiMeta={aiMeta}
                      aiThreshold={aiThreshold}
                      autoRotate={autoRotate}
                      axisVisible={axisVisible}
                      cloud={cloud}
                      dataSource={dataSource}
                      depthExaggeration={depthExaggeration}
                      effectivePointColorBy={effectivePointColorBy}
                      flipX={flipX}
                      fromProb={fromProb}
                      plotType={plotType}
                      pointEngine={pointEngine}
                      scale={scale}
                      setAiThreshold={setAiThreshold}
                      setAutoRotate={setAutoRotate}
                      setAxisVisible={setAxisVisible}
                      setDepthExaggerationInput={setDepthExaggerationInput}
                      setDimReadouts={setDimReadouts}
                      setDimensionMode={setDimensionMode}
                      setFlipX={setFlipX}
                      setPlotType={setPlotType}
                      setPointColorBy={setPointColorBy}
                      setPointEngine={setPointEngine}
                      setShowSlice={setShowSlice}
                      setSurfaceEngine={setSurfaceEngine}
                      setViewMode={setViewMode}
                      showPlot={showPlot}
                      surfaceEngine={surfaceEngine}
                      viewMode={viewMode}
                      zData={zData}
                    />

                    {/* 計測ツール */}
                    <MeasureToolsSection
                      addDimLine={addDimLine}
                      cloud={cloud}
                      dimReadouts={dimReadouts}
                      dimensionMode={dimensionMode}
                      measureMode={measureMode}
                      measurePt1={measurePt1}
                      measurePt2={measurePt2}
                      measureStateRef={measureStateRef}
                      removeDimLine={removeDimLine}
                      setDimReadouts={setDimReadouts}
                      setDimensionMode={setDimensionMode}
                      setMeasureMode={setMeasureMode}
                      setMeasurePt1={setMeasurePt1}
                      setMeasurePt2={setMeasurePt2}
                      setShowSlice={setShowSlice}
                      setSliceLineEnd={setSliceLineEnd}
                      setSliceLineStart={setSliceLineStart}
                      showPlot={showPlot}
                      showSlice={showSlice}
                      viewMode={viewMode}
                      zData={zData}
                    />
                  </>
                )}

                {/* 測定結果タブ */}
                {sideTab === "result" && (
                  <ResultTab
                    cloud={cloud}
                    zData={viewZ}
                    postResult={postResult}
                    dataSource={dataSource}
                    scale={scale}
                    flipX={flipX}
                    flipRef={flipRef}
                    processing={processing}
                    history={cloudHistory}
                    historyUsage={historyUsage}
                    currentHistoryId={currentHistoryId}
                    editingNameIdx={editingNameIdx}
                    setEditingNameIdx={setEditingNameIdx}
                    editingNameValue={editingNameValue}
                    setEditingNameValue={setEditingNameValue}
                    renameEntry={renameEntry}
                    setDeleteConfirmIdx={setDeleteConfirmIdx}
                    onRestore={async (item: HistoryItem) => {
                      // 古い履歴はブラウザの保存から読む
                      const entry = await loadEntry(item);
                      if (!entry) {
                        alert("この測定履歴のデータを読み込めませんでした");
                        return;
                      }
                      // 高さマップ・表示タイプ・出どころまで丸ごと戻す（点群だけ戻すと、
                      // Surface や断面に別の計測の高さマップが出ていた）
                      setCurrentHistoryId(item.id);
                      setShowSlice(false);
                      setCloud(entry.cloud);
                      setZData(entry.grid);
                      setPost(POST_OFF);
                      setPlotType(entry.plotType);
                      setDataSource(entry.dataSource);
                      setDataName(entry.dataName);
                      setDataOrigin(entry.origin);
                      setProcessing(entry.processing);
                      setAiThreshold(entry.processing?.threshold ?? null);
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
      <AlgorithmModal
        algorithm={algorithm}
        setAlgorithm={setAlgorithm}
        setShowAlgorithms={setShowAlgorithms}
        showAlgorithms={showAlgorithms}
      />

      {/* 確認モーダル */}
      <ConfirmModal
        algorithm={algorithm}
        confirmMode={confirmMode}
        handleConfirmCancel={handleConfirmCancel}
        handleConfirmOk={handleConfirmOk}
        showConfirm={showConfirm}
        useGpu={useGpu}
      />
      <DeleteHistoryModal
        clearHistory={clearHistory}
        deleteConfirmIdx={deleteConfirmIdx}
        removeEntry={removeEntry}
        setDeleteConfirmIdx={setDeleteConfirmIdx}
      />
    </>
  );
}

export default App;
