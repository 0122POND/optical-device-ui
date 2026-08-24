// src/hooks/useWakeLock.ts
import { useEffect } from "react";

// active の間、Screen Wake Lock API で画面のスリープ・暗転を防止するフック。
// 展示会デモ（自動回転）中に画面が落ちないようにするために使う。
// タブが非表示になるとロックはOS側で自動解放されるため、再表示時に取り直す。
// 非対応ブラウザや非セキュアコンテキスト(https/localhost以外)では何もしない。
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (!("wakeLock" in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let disposed = false;

    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request("screen");
        if (disposed) {
          void l.release();
        } else {
          lock = l;
        }
      } catch {
        // 省電力モード等で拒否されることがある。失敗しても回転自体は続ける
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release();
      lock = null;
    };
  }, [active]);
}
