// src/hooks/usePlotlyAutoRotate.ts
import { useEffect } from "react";
import Plotly from "plotly.js-dist-min";

// 1周 ≒ 24秒（three.js側の AUTO_ROTATE_SPEED=2.5 と体感を揃える）
const ROTATE_SPEED_RAD_PER_SEC = (2 * Math.PI) / 24;

// Plotly 3Dシーンのカメラを注視点まわりに水平周回（高さ軸=z回り）させるフック。
// Surface / Plotly点群の自動回転に使う。ドラッグ中(pointerdown〜pointerup)は
// 一時停止し、離すと現在のカメラ位置から再開する。
export function usePlotlyAutoRotate(params: {
  plotRef: React.RefObject<HTMLDivElement | null>;
  active: boolean;
}) {
  const { plotRef, active } = params;

  useEffect(() => {
    if (!active) return;
    const el = plotRef.current;
    if (!el) return;

    let raf = 0;
    let paused = false;
    let prev = performance.now();
    const onDown = () => {
      paused = true;
    };
    const onUp = () => {
      paused = false;
      prev = performance.now();
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - prev) / 1000, 0.1);
      prev = now;
      if (paused) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scene = (el as any)._fullLayout?.scene?._scene;
      const cam = scene?.getCamera?.();
      if (!cam) return; // シーン未初期化の間は何もしない

      const center = cam.center ?? { x: 0, y: 0, z: 0 };
      const dx = cam.eye.x - center.x;
      const dy = cam.eye.y - center.y;
      const a = ROTATE_SPEED_RAD_PER_SEC * dt;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // カメラを丸ごと渡すことで usePlotly 側の plotly_relayout ハンドラ
      // （scene.camera を保存）にも乗り、回転停止後・再描画後も視点が維持される
      Plotly.relayout(el, {
        "scene.camera": {
          ...cam,
          eye: {
            x: center.x + dx * cos - dy * sin,
            y: center.y + dx * sin + dy * cos,
            z: cam.eye.z,
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [active, plotRef]);
}
