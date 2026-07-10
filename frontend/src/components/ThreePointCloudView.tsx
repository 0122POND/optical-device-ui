import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PointCloud } from "../utils/pointCloud";

// 既存 Plotly と同じ5段カラースケール（青→水色→緑→橙→赤）
const STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [0, 0, 255]],
  [0.25, [0, 191, 255]],
  [0.5, [0, 255, 0]],
  [0.75, [255, 191, 0]],
  [1.0, [255, 0, 0]],
];

function colorAt(t: number): [number, number, number] {
  const tt = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (tt <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const f = (tt - t0) / (t1 - t0 || 1);
      return [
        (c0[0] + (c1[0] - c0[0]) * f) / 255,
        (c0[1] + (c1[1] - c0[1]) * f) / 255,
        (c0[2] + (c1[2] - c0[2]) * f) / 255,
      ];
    }
  }
  return [1, 0, 0];
}

// three.js による点群ビューア（Plotly版の代替）。数十万〜百万点でも WebGL バッファを
// 一度だけアップロードして描くため、Plotly の scatter3d より遥かに軽い。
export function ThreePointCloudView(props: {
  cloud: PointCloud | null;
  flipX: boolean;
  umPerPixelX: number;
  umPerPixelY: number;
  sweepInterval: string;
  isBuilding?: boolean;
}) {
  const { cloud, flipX, umPerPixelX, umPerPixelY, sweepInterval, isBuilding } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    points?: THREE.Points;
  } | null>(null);

  // 初期化（マウント時に1回）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x0b0b0f, 1);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1e7);
    camera.position.set(0, 0, 1000);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    let raf = requestAnimationFrame(function loop() {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    });

    const ro = new ResizeObserver(() => {
      const ww = container.clientWidth || 1;
      const hh = container.clientHeight || 1;
      renderer.setSize(ww, hh);
      camera.aspect = ww / hh;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    stateRef.current = { renderer, scene, camera, controls };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      const pts = stateRef.current?.points;
      if (pts) {
        pts.geometry.dispose();
        (pts.material as THREE.Material).dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      stateRef.current = null;
    };
  }, []);

  // cloud 変更時にジオメトリ再構築
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;

    // 既存点群を破棄
    if (st.points) {
      st.scene.remove(st.points);
      st.points.geometry.dispose();
      (st.points.material as THREE.Material).dispose();
      st.points = undefined;
    }
    if (!cloud || cloud.x.length === 0) return;

    const n = cloud.x.length;

    // 座標変換（usePlotly の pointGeom と同一ロジック）
    let maxX = cloud.x[0];
    if (flipX) for (let i = 1; i < n; i++) if (cloud.x[i] > maxX) maxX = cloud.x[i];
    const sweepVal = parseFloat(sweepInterval);
    const zUmPerSlice = !isNaN(sweepVal) && sweepVal > 0 ? sweepVal : umPerPixelY;

    // c の範囲（色付け用）
    let cMin = Infinity;
    let cMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = cloud.c[i];
      if (v < cMin) cMin = v;
      if (v > cMax) cMax = v;
    }
    const cRange = cMax - cMin || 1;

    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxXu = -Infinity,
      maxYu = -Infinity,
      maxZu = -Infinity;
    for (let i = 0; i < n; i++) {
      const xu = (flipX ? maxX - cloud.x[i] : cloud.x[i]) * umPerPixelX;
      const yu = cloud.y[i] * umPerPixelY;
      const zu = cloud.z[i] * zUmPerSlice;
      pos[i * 3] = xu;
      pos[i * 3 + 1] = yu;
      pos[i * 3 + 2] = zu;
      const [r, g, b] = colorAt((cloud.c[i] - cMin) / cRange);
      col[i * 3] = r;
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = b;
      if (xu < minX) minX = xu;
      if (xu > maxXu) maxXu = xu;
      if (yu < minY) minY = yu;
      if (yu > maxYu) maxYu = yu;
      if (zu < minZ) minZ = zu;
      if (zu > maxZu) maxZu = zu;
    }

    // 原点中心化（大きな µm 座標での精度・カメラ設定を安定させる）
    const cx = (minX + maxXu) / 2;
    const cy = (minY + maxYu) / 2;
    const cz = (minZ + maxZu) / 2;
    for (let i = 0; i < n; i++) {
      pos[i * 3] -= cx;
      pos[i * 3 + 1] -= cy;
      pos[i * 3 + 2] -= cz;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true });
    const points = new THREE.Points(geom, mat);
    st.scene.add(points);
    st.points = points;

    // カメラをデータ範囲にフィット
    const radius = Math.max(maxXu - minX, maxYu - minY, maxZu - minZ, 1);
    st.controls.target.set(0, 0, 0);
    st.camera.position.set(radius * 0.8, radius * 0.6, radius * 1.2);
    st.camera.near = radius / 1000;
    st.camera.far = radius * 20;
    st.camera.updateProjectionMatrix();
    st.controls.update();
  }, [cloud, flipX, umPerPixelX, umPerPixelY, sweepInterval]);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 5 }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {isBuilding && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            padding: "4px 10px",
            background: "rgba(0,0,0,0.6)",
            color: "#fff",
            fontSize: 12,
            borderRadius: 6,
          }}
        >
          高密度点群を構築中…
        </div>
      )}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 8,
          padding: "3px 8px",
          background: "rgba(0,0,0,0.5)",
          color: "#9ad",
          fontSize: 11,
          borderRadius: 6,
        }}
      >
        three.js{cloud ? ` / ${cloud.x.length.toLocaleString()}点` : ""}
      </div>
    </div>
  );
}
