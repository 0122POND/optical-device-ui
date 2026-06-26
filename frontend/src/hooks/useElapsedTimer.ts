import { useEffect, useRef, useState } from "react";
import type { MeasureStatus } from "../types";

// 処理経過時間(ms)。RUNNING 中は 100ms ごとにカウントアップし、終了時に最終値で確定する。
export function useElapsedTimer(status: MeasureStatus): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  const runStartRef = useRef<number>(0);

  useEffect(() => {
    if (status !== "RUNNING") return;
    runStartRef.current = Date.now();
    // RUN開始時に表示を即0へ戻す一回限りのリセット（カスケード再描画ではない）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - runStartRef.current);
    }, 100);
    return () => {
      window.clearInterval(id);
      setElapsedMs(Date.now() - runStartRef.current);
    };
  }, [status]);

  return elapsedMs;
}
