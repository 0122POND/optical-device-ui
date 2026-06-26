import { useCallback, useEffect, useRef } from "react";
import { buildPointCloudFromFolder, type PointCloud } from "../utils/pointCloud";
import type { HistorySource, PlotType } from "../types";

const WS_URL = `ws://${window.location.hostname}:8000/ws`;

export type WsProgress = { step: number; total: number; message: string; percent: number };

// applyCloudResult に渡すオプション（呼び出し元 App と共有する形）
export type ApplyCloudOpts = {
  plotType: PlotType;
  source: HistorySource;
  name?: string;
  progress?: { message: string; percent: number };
  clearLoading?: "ai" | "acquire";
};

export type UseWebSocketArgs = {
  // maxTotalPoints の出し分けと preprocess 完了時の履歴 source に使う。
  // onmessage は一度しか張られないため、フック内で ref に同期して最新値を読む。
  algorithm: string;
  applyCloudResult: (
    cloud: PointCloud,
    grid: (number | null)[][] | null,
    opts: ApplyCloudOpts
  ) => void;
  onProgress: (p: WsProgress) => void;
  onStatus: (value: "READY" | "RUNNING" | "COMPLETE") => void;
  onError: (kind: "ai" | "acquire" | "generic", message: string) => void;
};

/**
 * バックエンドとの WebSocket 接続を管理するフック。
 * - マウント時に接続、アンマウント時にクローズ。
 * - onmessage は connect 内で一度だけ張るため、最新の引数（コールバック・algorithm）は
 *   argsRef 経由で読む（connect を [] 依存に保ち、再接続チャーンを避けるため）。
 * - connect() は handleConfirmOk から呼ばれ、開いている接続を再利用しつつ送信用に返す。
 */
export function useWebSocket(args: UseWebSocketArgs): { connect: () => WebSocket } {
  const wsRef = useRef<WebSocket | null>(null);
  // stale closure 回避: 最新の引数を ref に同期する（render中のref書き込みは
  // react-hooks/refs で禁止のため effect で行う。onmessage は非同期発火なので間に合う）
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  });

  const connect = useCallback((): WebSocket => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return wsRef.current;
    }

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("WebSocket connected");
    };

    ws.onmessage = async (event) => {
      const a = argsRef.current; // 常に最新のコールバック・algorithm
      try {
        const data = JSON.parse(event.data);
        console.log("WS message:", data);

        if (data.type === "progress") {
          a.onProgress({
            step: data.step,
            total: data.total,
            message: data.message,
            percent: data.percent,
          });
        } else if (data.type === "ai_inference_complete") {
          console.log("AI推論完了:", data.count, "files", "device:", data.device);
          try {
            const { cloud: newCloud, grid: newGrid } = await buildPointCloudFromFolder({
              folderUrl: "/data/mask_result",
              threshold: 128,
              samplePerSlice: 4000,
              flipZ: false,
              colorMode: "z",
              ...(a.algorithm === "tgv" ? { maxTotalPoints: 250_000 } : {}),
            });

            a.applyCloudResult(newCloud, newGrid, {
              plotType: "scatter3d",
              source: "ai",
              progress: { message: `AI推論完了 (${data.device})`, percent: 100 },
              clearLoading: "ai",
            });
            console.log("AI点群生成完了", { points: newCloud.x.length });
          } catch (e) {
            console.error(e);
            a.onError("ai", (e as Error).message);
          }
        } else if (data.type === "preprocess_complete") {
          console.log("画像処理完了:", data.count, "files");
          // 処理完了後、点群を読み込み
          try {
            const { cloud: newCloud, grid: newGrid } = await buildPointCloudFromFolder({
              folderUrl: "/data/result",
              threshold: 128,
              samplePerSlice: 4000,
              flipZ: false,
              colorMode: "z",
              ...(a.algorithm === "tgv" ? { maxTotalPoints: 250_000 } : {}),
            });

            a.applyCloudResult(newCloud, newGrid, {
              plotType: "scatter3d",
              source: a.algorithm as HistorySource,
              progress: { message: "完了", percent: 100 },
              clearLoading: "acquire",
            });
            console.log("点群生成完了", { points: newCloud.x.length });
          } catch (e) {
            console.error(e);
            a.onError("acquire", (e as Error).message);
          }
        } else if (data.type === "status") {
          if (data.value === "RUNNING") {
            a.onStatus("RUNNING");
          } else if (data.value === "COMPLETE") {
            // preprocess_completeで処理するので、ここでは何もしない
          } else if (data.value === "READY") {
            a.onStatus("READY");
          }
        } else if (data.type === "error") {
          console.error("Server error:", data.message);
          a.onError("generic", data.message);
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

  // マウント時に接続、アンマウント時にクローズ
  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { connect };
}
