import { useEffect, useRef, useState, useCallback } from "react";
import Plotly from "plotly.js-dist-min";
import { generateCoinData, addNoise } from "./utils/surface";
import { downloadCSV } from "./utils/csv";
import { buildPointCloudFromFolder, type PointCloud } from "./utils/pointCloud";
import "./App.css";

const WS_URL = "ws://localhost:8000/ws";

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
const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function App() {
  const GRID_SIZE = 80;
  const plotRef = useRef<HTMLDivElement | null>(null);
  const sliceRef = useRef<HTMLDivElement | null>(null);

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null);

  // 軸表示フラグ（true = 表示 / false = 非表示）
  const [axisVisible, setAxisVisible] = useState(true);

  // 確認ダイアログの表示フラグ
  const [showConfirm, setShowConfirm] = useState(false);

  // 確認ダイアログの種類（3D開始 or CSV出力）
  const [confirmMode, setConfirmMode] = useState<"plot" | "csv" | null>(null);

  // 3Dグラフを表示するかどうか
  const [showPlot, setShowPlot] = useState(false);

  // 断層グラフを表示するかどうか
  const [showSlice, setShowSlice] = useState(false);

  // 断層位置（0~GRID_SIZE-1を動かす)
  const [sliceIndex, setSliceIndex] = useState(Math.floor(GRID_SIZE / 2));

  // 計測ステータス
  type MeasureStatus = "READY" | "RUNNING" | "COMPLETE";
  const [status, setStatus] = useState<MeasureStatus>("READY");

  // 掃引関連の入力値 & 単位
  const [sweepInterval, setSweepInterval] = useState("");
  const [sweepRange, setSweepRange] = useState("");
  const [sweepIntervalUnit, setSweepIntervalUnit] = useState<"um" | "mm">("um");
  const [sweepRangeUnit, setSweepRangeUnit] = useState<"um" | "mm">("um");

  // 次の掃引までの時間間隔 & 単位 (s / ms)
  const [sweepTimeInterval, setSweepTimeInterval] = useState("");
  const [sweepTimeUnit, setSweepTimeUnit] = useState<"s" | "ms">("ms");

  const [zData, setZData] = useState<(number | null)[][] | null>(null);
  const [cloud, setCloud] = useState<PointCloud | null>(null);
  const [_cloudMeta, setCloudMeta] = useState<{ width: number; height: number; depth: number } | null>(null);

  // 進捗表示用
  const [progressStep, setProgressStep] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);

  // 取得中フラグ
  const [isAcquiring, setIsAcquiring] = useState(false);

  // About Usポップアップ表示フラグ
  const [showAbout, setShowAbout] = useState(false);

  // setTimeout のID保持（連打対策 & アンマウント対策）
  const acquireTimerRef = useRef<number | null>(null);

  const inputStyle: React.CSSProperties = {
    height: "36px",
    padding: "6px 12px",
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
    height: "36px",
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
    height: "42px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: colors.primary,
    color: colors.text,
    fontSize: "14px",
    fontWeight: 600,
    fontFamily: fontFamily,
    cursor: "pointer",
    transition: "background-color 0.2s, opacity 0.2s",
  };

  const buttonSecondaryStyle: React.CSSProperties = {
    height: "38px",
    borderRadius: "6px",
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.bgDark,
    color: colors.text,
    fontSize: "13px",
    fontWeight: 500,
    fontFamily: fontFamily,
    cursor: "pointer",
    transition: "background-color 0.2s",
  };

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
          padding: "4px 10px",
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
          }}
        />
        {c.label}
      </div>
    );
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
        } else if (data.type === "preprocess_complete") {
          console.log("画像処理完了:", data.count, "files");
          // 処理完了後、点群を読み込み
          try {
            const { cloud, width, height, depth } = await buildPointCloudFromFolder({
              folderUrl: "/data/result",
              threshold: 128,
              samplePerSlice: 4000,
              flipZ: true,
              colorMode: "z",
            });

            setCloud(cloud);
            setCloudMeta({ width, height, depth });
            setIsAcquiring(false);
            setStatus("COMPLETE");
            setProgressMessage("完了");
            setProgressPercent(100);
            console.log("点群生成完了", { points: cloud.x.length, width, height, depth });
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
    return () => {
      if (acquireTimerRef.current != null) {
        window.clearTimeout(acquireTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showPlot || !plotRef.current) return;

    requestAnimationFrame(() => {
      Plotly.Plots.resize(plotRef.current as any);
    });
  }, [showSlice, showPlot]);

  useEffect(() => {
    if (!plotRef.current) return;

    if (!showPlot) {
      Plotly.purge(plotRef.current);
      return;
    }
    if (!cloud) {
      Plotly.purge(plotRef.current);
      return;
    }

    const azim = 20;
    const elev = 10;

    const az = (azim * Math.PI) / 180;
    const el = (elev * Math.PI) / 180;
    const cam = {
      eye: {
        x: 2.0 * Math.cos(az) * Math.cos(el),
        y: 2.0 * Math.sin(az) * Math.cos(el),
        z: 2.0 * Math.sin(el) + 0.5,
      },
    };

    const data: any[] = [
      {
        type: "scatter3d",
        mode: "markers",
        x: cloud.x,
        y: cloud.y,
        z: cloud.z,
        marker: {
          size: 1,
          opacity: 0.08,
          color: cloud.c,
          colorscale: "Viridis",
          showscale: true,
          colorbar: { title: "Z (flipped)", x: 1.02, thickness: 18, len: 0.75 },
        },
      },
    ];

    const layout: any = {
      title: `Point cloud (thr>128, points=${cloud.x.length.toLocaleString()})`,
      autosize: true,
      margin: { l: 0, r: 0, t: 30, b: 0 },
      scene: {
        xaxis: {
          title: axisVisible ? "X" : "",
          visible: axisVisible,
          showgrid: axisVisible,
          zeroline: axisVisible,
        },
        yaxis: {
          title: axisVisible ? "Y" : "",
          visible: axisVisible,
          showgrid: axisVisible,
          zeroline: axisVisible,
        },
        zaxis: {
          title: axisVisible ? "Z (flipped)" : "",
          visible: axisVisible,
          showgrid: axisVisible,
          zeroline: axisVisible,
        },
        aspectmode: "manual",
        aspectratio: { x: 1, y: 1, z: 1.0 },
        camera: cam,
      },
    };

    const config: any = { responsive: true, displaylogo: false };

    Plotly.newPlot(plotRef.current, data, layout, config);

    return () => {
      if (plotRef.current) Plotly.purge(plotRef.current);
    };
  }, [showPlot, axisVisible, cloud]);

  // --- 2D 断層グラフ描画 ---
  useEffect(() => {
    if (!sliceRef.current) return;

    if (!showSlice || !zData) {
      Plotly.purge(sliceRef.current);
      return;
    }

    const row = zData[sliceIndex];
    const x = row.map((_, i) => i);
    const y = row.map((v) => (v == null ? null : v));

    const data = [
      {
        x,
        y,
        type: "scatter" as const,
        mode: "lines",
      },
    ];

    const layout = {
      title: `断層（y = ${sliceIndex}）`,
      margin: { l: 40, r: 10, t: 30, b: 40 },
      xaxis: { title: "X index" },
      yaxis: { title: "Height" },
      height: 250,
      paper_bgcolor: colors.bgDark,
      plot_bgcolor: colors.bgDark,
      font: { color: colors.text },
    };

    const config = {
      responsive: true,
      displaylogo: false,
    };

    Plotly.newPlot(sliceRef.current, data as any, layout as any, config as any);

    return () => {
      if (sliceRef.current) {
        Plotly.purge(sliceRef.current);
      }
    };
  }, [showSlice, zData, sliceIndex]);

  const handleConfirmOk = () => {
    if (confirmMode === "plot") {
      if (acquireTimerRef.current != null) {
        window.clearTimeout(acquireTimerRef.current);
      }

      // 表示初期化
      setShowPlot(true);
      setShowSlice(false);
      setZData(null);
      setCloud(null);
      setCloudMeta(null);

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
                data_path: "frontend/public/data/row_data/",
                result_path: "frontend/public/data/result/",
                num_images: 170,
                peak_threshold: 10,
              },
            })
          );
        } else {
          // 接続待ち
          setTimeout(sendCommand, 100);
        }
      };
      sendCommand();
    } else if (confirmMode === "csv") {
      if (zData) {
        downloadCSV(zData, "surface.csv");
      } else {
        const fallback = addNoise(generateCoinData(GRID_SIZE), 0.1);
        downloadCSV(fallback, "surface.csv");
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

  return (
    <>
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "grid",
          gridTemplateRows: "56px 1fr",
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
            backgroundColor: colors.bgLight,
            borderBottom: `1px solid ${colors.border}`,
            boxSizing: "border-box",
            gap: "10px",
          }}
        >
          <div
            style={{ position: "relative" }}
            onMouseEnter={() => setShowAbout(true)}
            onMouseLeave={() => setShowAbout(false)}
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
                  backgroundColor: colors.bgLight,
                  border: `1px solid ${colors.border}`,
                  borderRadius: "8px",
                  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
                  zIndex: 100,
                }}
              >
                <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "10px" }}>
                  About Us
                </div>
                <div style={{ fontSize: "12px", color: colors.textMuted, lineHeight: 1.6 }}>
                  光学デバイスから取得した3次元面形状をブラウザで可視化するWebアプリケーションです。
                </div>
                <div
                  style={{
                    marginTop: "12px",
                    paddingTop: "10px",
                    borderTop: `1px solid ${colors.border}`,
                    fontSize: "11px",
                    color: colors.textDim,
                  }}
                >
                  <div>Version: 0.1.0</div>
                  <div style={{ marginTop: "4px" }}>© 2026 Trillion Technology</div>
                </div>
              </div>
            )}
          </div>

          <div style={{ fontWeight: 600, fontSize: "16px", letterSpacing: "0.3px" }}>
            3D Surface Measurement UI
          </div>

          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <StatusBadge status={status} />

            <div style={{ fontSize: "12px", color: colors.textMuted }}>Ver. 0.1.0</div>
          </div>
        </div>

        {/* メインエリア */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "280px 1fr",
            height: "100%",
            overflow: "hidden",
          }}
        >
          {/* 左：サイドパネル */}
          <div
            style={{
              height: "100%",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              backgroundColor: colors.bgLight,
              boxSizing: "border-box",
              borderRight: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ fontSize: "15px", fontWeight: 600, letterSpacing: "0.3px" }}>
              スキャン設定
            </div>

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
                    flex: 1,
                  }}
                />
                <select
                  value={sweepIntervalUnit}
                  onChange={(e) =>
                    setSweepIntervalUnit(e.target.value as "um" | "mm")
                  }
                  style={unitSelectStyle}
                >
                  <option value="um">µm</option>
                  <option value="mm">mm</option>
                </select>
              </div>
            </div>

            {/* 掃引範囲 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "13px", color: colors.textMuted }}>掃引範囲</label>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="入力してください"
                  value={sweepRange}
                  onChange={(e) => setSweepRange(e.target.value)}
                  style={{
                    ...inputStyle,
                    flex: 1,
                  }}
                />
                <select
                  value={sweepRangeUnit}
                  onChange={(e) =>
                    setSweepRangeUnit(e.target.value as "um" | "mm")
                  }
                  style={unitSelectStyle}
                >
                  <option value="um">µm</option>
                  <option value="mm">mm</option>
                </select>
              </div>
            </div>

            {/* 次の掃引までの時間間隔 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "13px", color: colors.textMuted }}>次の掃引までの時間間隔</label>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="入力してください"
                  value={sweepTimeInterval}
                  onChange={(e) => setSweepTimeInterval(e.target.value)}
                  style={{
                    ...inputStyle,
                    flex: 1,
                    minWidth: 0,
                  }}
                />
                <select
                  value={sweepTimeUnit}
                  onChange={(e) =>
                    setSweepTimeUnit(e.target.value as "ms" | "s")
                  }
                  style={unitSelectStyle}
                >
                  <option value="ms">ms</option>
                  <option value="s">s</option>
                </select>
              </div>
            </div>

            <div
              style={{
                height: "1px",
                backgroundColor: colors.border,
                margin: "8px 0",
              }}
            />

            {/* STARTボタン */}
            <button
              disabled={status === "RUNNING"}
              style={{
                ...buttonPrimaryStyle,
                backgroundColor: status === "RUNNING" ? colors.borderLight : colors.primary,
                cursor: status === "RUNNING" ? "not-allowed" : "pointer",
                marginTop: "4px",
                opacity: status === "RUNNING" ? 0.7 : 1,
              }}
              onClick={() => {
                setConfirmMode("plot");
                setShowConfirm(true);
              }}
            >
              {status === "RUNNING" ? "処理中..." : "START"}
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
                backgroundColor: axisVisible ? colors.borderLight : colors.bgDark,
                cursor: showPlot ? "pointer" : "not-allowed",
                opacity: showPlot ? 1 : 0.5,
              }}
            >
              {axisVisible ? "軸を非表示" : "軸を表示"}
            </button>

            {/* CSV出力ボタン */}
            <button
              style={{
                ...buttonSecondaryStyle,
                height: "42px",
                backgroundColor: colors.bgDark,
                marginTop: "8px",
              }}
              onClick={() => {
                setConfirmMode("csv");
                setShowConfirm(true);
              }}
            >
              CSVファイルを出力
            </button>

            {/* 断層 出力/停止 トグルボタン */}
            <button
              disabled={!zData}
              style={{
                ...buttonSecondaryStyle,
                height: "42px",
                border: "none",
                backgroundColor: showSlice ? colors.danger : colors.secondary,
                cursor: zData ? "pointer" : "not-allowed",
                opacity: zData ? 1 : 0.5,
                marginTop: "8px",
              }}
              onClick={() => {
                if (!zData) return;
                setShowSlice((v) => !v);
              }}
            >
              {showSlice ? "断層出力を停止" : "断層を出力"}
            </button>

            {/* 断層位置スライダー */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "13px", color: colors.textMuted }}>断層位置（y）: {sliceIndex}</label>

              <input
                type="range"
                min={0}
                max={GRID_SIZE - 1}
                step={1}
                value={sliceIndex}
                disabled={!showSlice || !zData}
                onChange={(e) => setSliceIndex(Number(e.target.value))}
                style={{ width: "100%" }}
              />

              <div style={{ fontSize: "12px", color: colors.textDim }}>
                {!zData && "※先に断層出力 or START でデータ生成してください"}
              </div>
            </div>

            <div style={{ flexGrow: 1 }} />
          </div>

          {/* 右：3D Plot + 2D断層 エリア */}
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
            <div style={{ flex: 1, minHeight: 0 }}>
              <div
                ref={plotRef}
                style={{ width: "100%", height: "100%", position: "relative" }}
              >
                {!showPlot && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: colors.textDim,
                      fontSize: "15px",
                    }}
                  >
                    左側の「START」ボタンから
                    <br />
                    3次元形状計測を開始してください。
                  </div>
                )}

                {isAcquiring && (
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
                      画像処理中...
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

                    <div style={{ fontSize: "12px", color: colors.textMuted }}>
                      {progressPercent}%
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 下：2D 断層グラフ */}
            {showSlice && (
              <div style={{ height: "260px" }}>
                <div
                  ref={sliceRef}
                  style={{ width: "100%", height: "100%" }}
                />
              </div>
            )}
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
              {confirmMode === "csv"
                ? "csvファイルを出力しますか？"
                : "3次元形状計測を開始しますか？"}
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
                  padding: "8px 18px",
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
                  padding: "8px 18px",
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
    </>
  );
}

export default App;
