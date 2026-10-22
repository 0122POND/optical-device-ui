import { useState } from "react";
import type { RefObject } from "react";
import Plotly from "plotly.js-dist-min";
import type { DragMode, PlotType, ViewMode, ViewPresetKind, ViewPresetRequest } from "../types";

// プロット操作（フローティングツールバーから呼ぶ）: ズーム・ドラッグモード・視点のプリセット・視点リセット・画像保存
export function usePlotControls(args: {
  plotRef: RefObject<HTMLDivElement | null>;
  plotType: PlotType;
  viewMode: ViewMode;
  setAutoRotate: (v: boolean) => void;
}) {
  const { plotRef, plotType, viewMode, setAutoRotate } = args;
  // ドラッグモード（pan / turntable / orbit）
  const [dragMode, setDragMode] = useState<DragMode>("turntable");

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

  // 視点のプリセット要求（three.js 表示へ渡す。同じ向きの連打でも反映されるよう通し番号付き）
  const [viewPreset, setViewPreset] = useState<ViewPresetRequest>(null);

  // 正面（横方向×奥行き）・側面（縦方向×奥行き）・上面（横方向×縦方向）へ切り替える。
  // Plotly の平行投影はズームが効かず、投影と視点を同時に変えると描画が追従しないため、遠近のまま
  // 箱の大きさ（aspectratio。奥行きの強調で伸びる）に合わせて引いた位置から見る
  const handleViewPreset = (kind: Exclude<ViewPresetKind, "reset">) => {
    setAutoRotate(false);
    setViewPreset((p) => ({ kind, n: (p?.n ?? 0) + 1 }));
    const el = plotRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!el || !(el as any)._fullLayout?.scene) return; // three.js 表示中は Plotly のシーンが無い
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asp = (el as any)._fullLayout.scene.aspectratio ?? { x: 1, y: 1, z: 1 };
    const d = Math.max(2.2, 1.3 * Math.max(asp.x, asp.y, asp.z));
    // 軸の割り当て: surface は x=縦方向(列), y=横方向(行), z=高さ / 点群は x=奥行き, y=縦方向, z=横方向
    const cams =
      plotType === "surface"
        ? {
            front: { eye: { x: d, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
            side: { eye: { x: 0, y: -d, z: 0 }, up: { x: 0, y: 0, z: 1 } },
            top: { eye: { x: 0, y: 0, z: d }, up: { x: 0, y: 1, z: 0 } },
          }
        : {
            front: { eye: { x: 0, y: d, z: 0 }, up: { x: 1, y: 0, z: 0 } },
            side: { eye: { x: 0, y: 0, z: d }, up: { x: 1, y: 0, z: 0 } },
            top: { eye: { x: d, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
          };
    Plotly.relayout(el, {
      "scene.camera": {
        ...cams[kind],
        center: { x: 0, y: 0, z: 0 },
        projection: { type: "perspective" },
      },
    });
  };

  const handleCameraReset = () => {
    setViewPreset((p) => ({ kind: "reset", n: (p?.n ?? 0) + 1 }));
    const el = plotRef.current;
    if (!el) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(el as any)._fullLayout?.scene) return;
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
              up: { x: 0, y: 0, z: 1 },
            };
          })();
    Plotly.relayout(el, {
      "scene.camera": {
        ...cam,
        center: { x: 0, y: 0, z: 0 },
        projection: { type: "perspective" },
      },
    });
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

  return {
    dragMode,
    handleZoom,
    handleDragMode,
    viewPreset,
    handleViewPreset,
    handleCameraReset,
    handleDownload,
  };
}
