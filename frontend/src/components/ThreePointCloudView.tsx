import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { colorForValue, resolveColorRange } from "../utils/colorRange";
import type { PointCloud } from "../utils/pointCloud";

// 自動回転の速さ（OrbitControls.autoRotateSpeed 単位。2.0 ≒ 60fpsで1周30秒）
const AUTO_ROTATE_SPEED = 2.5;

// 深さ配列に対しカラーレンジ（手動 or 自動ロバスト）を解決し、色バッファへ
// 書き込む（レンジ外はグレー）
function fillColors(depthUm: Float64Array, arr: Float32Array, min: string, max: string) {
  const range = resolveColorRange(depthUm, min, max);
  for (let i = 0; i < depthUm.length; i++) {
    const [r, g, b] = colorForValue(depthUm[i], range.lo, range.hi);
    arr[i * 3] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
  }
}

// three.js による点群ビューア（Plotly版の代替）。数十万〜百万点でも WebGL バッファを
// 一度だけアップロードして描くため、Plotly の scatter3d より遥かに軽い。
export function ThreePointCloudView(props: {
  cloud: PointCloud | null;
  flipX: boolean;
  umPerPixelX: number;
  umPerPixelY: number;
  sweepInterval: string;
  // カラーレンジの手動指定（µm, 空文字=自動）。レンジ外はグレー表示
  colorRangeMin: string;
  colorRangeMax: string;
  isBuilding?: boolean;
  // ターンテーブル自動回転（カメラを注視点まわりに水平周回させる）
  autoRotate?: boolean;
}) {
  const {
    cloud,
    flipX,
    umPerPixelX,
    umPerPixelY,
    sweepInterval,
    colorRangeMin,
    colorRangeMax,
    isBuilding,
    autoRotate,
  } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    points?: THREE.Points;
    depthUm?: Float64Array;
  } | null>(null);
  // 自動回転の最新状態。描画ループ（マウント時に1回だけ生成）から参照するため ref に持つ
  const rotateRef = useRef(false);
  rotateRef.current = !!autoRotate;
  // カラーレンジの最新値。ジオメトリ再構築effectの依存に入れずに読むための ref
  // （依存に入れるとレンジ入力のたびに再構築＋カメラリセットが起きる）
  const rangeRef = useRef({ min: colorRangeMin, max: colorRangeMax });
  rangeRef.current = { min: colorRangeMin, max: colorRangeMax };

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
      // 自動回転: カメラを注視点まわりに水平周回させる（画面の縦軸まわり）。
      // どの視点からでも「水平方向の回転」に見え、ドラッグ操作中は自動で一時停止する
      controls.autoRotate = rotateRef.current;
      controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
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
      st.depthUm = undefined;
    }
    if (!cloud || cloud.x.length === 0) return;

    const n = cloud.x.length;

    // 座標変換（usePlotly の pointGeom と同一ロジック）
    let maxX = cloud.x[0];
    if (flipX) for (let i = 1; i < n; i++) if (cloud.x[i] > maxX) maxX = cloud.x[i];
    const sweepVal = parseFloat(sweepInterval);
    const zUmPerSlice = !isNaN(sweepVal) && sweepVal > 0 ? sweepVal : umPerPixelY;

    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    // 色付けは Plotly 点群と同じ「深さ[µm]（X深度）」基準。先に座標変換して
    // 深さ配列を作り、カラーレンジ（手動 or 自動ロバスト）を解決してから塗る
    const depthUm = new Float64Array(n);
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
      depthUm[i] = xu;
      if (xu < minX) minX = xu;
      if (xu > maxXu) maxXu = xu;
      if (yu < minY) minY = yu;
      if (yu > maxYu) maxYu = yu;
      if (zu < minZ) minZ = zu;
      if (zu > maxZu) maxZu = zu;
    }

    fillColors(depthUm, col, rangeRef.current.min, rangeRef.current.max);

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
    st.depthUm = depthUm;

    // カメラをデータ範囲にフィット
    const radius = Math.max(maxXu - minX, maxYu - minY, maxZu - minZ, 1);
    st.controls.target.set(0, 0, 0);
    st.camera.position.set(radius * 0.8, radius * 0.6, radius * 1.2);
    st.camera.near = radius / 1000;
    st.camera.far = radius * 20;
    st.camera.updateProjectionMatrix();
    st.controls.update();
  }, [cloud, flipX, umPerPixelX, umPerPixelY, sweepInterval]);

  // カラーレンジ変更時は色バッファのみ更新（ジオメトリ・カメラは維持）
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.points || !st.depthUm) return;
    const attr = st.points.geometry.getAttribute("color") as THREE.BufferAttribute;
    fillColors(st.depthUm, attr.array as Float32Array, colorRangeMin, colorRangeMax);
    attr.needsUpdate = true;
  }, [colorRangeMin, colorRangeMax]);

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
