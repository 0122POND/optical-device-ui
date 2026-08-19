import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { colorForValue, resolveColorRange } from "../utils/colorRange";
import type { PointCloud } from "../utils/pointCloud";

// 展示デモ: 積み上げ再生の所要時間と、全点表示のまま保持する時間（秒）
const DEMO_BUILD_SEC = 8;
const DEMO_HOLD_SEC = 4;
// 自動回転の速さ（OrbitControls.autoRotateSpeed 単位。2.0 ≒ 60fpsで1周30秒）
const AUTO_ROTATE_SPEED = 2.5;

// 走査面（シート本体＋子のエッジライン）のジオメトリ・マテリアルを破棄する
function disposeScanPlane(plane: THREE.Mesh) {
  plane.geometry.dispose();
  (plane.material as THREE.Material).dispose();
  for (const ch of plane.children) {
    const line = ch as THREE.LineSegments;
    line.geometry?.dispose();
    (line.material as THREE.Material)?.dispose();
  }
}

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
  // 展示デモ: 走査再現の積み上げ再生をループする
  demoMode?: boolean;
  // ターンテーブル自動回転（高さ軸まわりに点群側を回す）
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
    demoMode,
    autoRotate,
  } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    // 点群と走査面をまとめて入れ替え・破棄するためのコンテナ
    group: THREE.Group;
    points?: THREE.Points;
    scanPlane?: THREE.Mesh;
    depthUm?: Float64Array;
  } | null>(null);
  // 自動回転・デモ再生の最新状態。描画ループ（マウント時に1回だけ生成）から
  // 参照するため ref に持つ
  const rotateRef = useRef(false);
  rotateRef.current = !!autoRotate;
  const demoRef = useRef({ active: false, start: 0 });
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

    const group = new THREE.Group();
    scene.add(group);

    let raf = requestAnimationFrame(function loop(now) {
      const st = stateRef.current;
      if (st) {
        // 自動回転: カメラを注視点まわりに水平周回させる（画面の縦軸まわり）。
        // どの視点からでも「水平方向の回転」に見え、ドラッグ操作中は自動で一時停止する
        controls.autoRotate = rotateRef.current;
        controls.autoRotateSpeed = AUTO_ROTATE_SPEED;

        // デモ再生: 走査順（点は行=スライス順に並ぶ）に drawRange を進めて
        // 「計測で点が積み上がる」様子を再現。完了後は少し保持して先頭からループ
        const demo = demoRef.current;
        if (demo.active && st.points) {
          const posAttr = st.points.geometry.getAttribute("position") as THREE.BufferAttribute;
          const nPts = posAttr.count;
          const t = (now - demo.start) / 1000;
          if (t < DEMO_BUILD_SEC) {
            const count = Math.max(1, Math.min(nPts, Math.floor((t / DEMO_BUILD_SEC) * nPts)));
            st.points.geometry.setDrawRange(0, count);
            if (st.scanPlane) {
              st.scanPlane.position.z = posAttr.getZ(count - 1);
              st.scanPlane.visible = true;
            }
          } else {
            st.points.geometry.setDrawRange(0, Infinity);
            if (st.scanPlane) st.scanPlane.visible = false;
            if (t >= DEMO_BUILD_SEC + DEMO_HOLD_SEC) demo.start = now;
          }
        }
      }
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

    stateRef.current = { renderer, scene, camera, controls, group };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      const pts = stateRef.current?.points;
      if (pts) {
        pts.geometry.dispose();
        (pts.material as THREE.Material).dispose();
      }
      const plane = stateRef.current?.scanPlane;
      if (plane) disposeScanPlane(plane);
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

    // 既存点群・走査面を破棄
    if (st.points) {
      st.group.remove(st.points);
      st.points.geometry.dispose();
      (st.points.material as THREE.Material).dispose();
      st.points = undefined;
      st.depthUm = undefined;
    }
    if (st.scanPlane) {
      st.group.remove(st.scanPlane);
      disposeScanPlane(st.scanPlane);
      st.scanPlane = undefined;
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
    st.group.add(points);
    st.points = points;
    st.depthUm = depthUm;

    // 走査面: デモ再生中に現在の走査位置(z=行方向)を示す半透明の光シート。
    // 高さ(x)スパンは薄いので、視認できる最低幅を確保する
    const spanX = maxXu - minX;
    const spanY = maxYu - minY;
    const planeGeom = new THREE.PlaneGeometry(Math.max(spanX * 1.4, spanY * 0.12), spanY * 1.02);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x4a90e2,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const scanPlane = new THREE.Mesh(planeGeom, planeMat);
    // シート本体は半透明で控えめなので、縁に明るいエッジラインを重ねて走査位置を強調
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(planeGeom),
      new THREE.LineBasicMaterial({ color: 0x7ec8ff, transparent: true, opacity: 0.9 })
    );
    scanPlane.add(edges);
    scanPlane.visible = false;
    st.group.add(scanPlane);
    st.scanPlane = scanPlane;

    // デモ再生中にデータが（再）構築されたら、最初から積み上げ直す
    if (demoRef.current.active) {
      demoRef.current.start = performance.now();
      geom.setDrawRange(0, 0);
    }

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

  // デモ再生の開始/停止。開始時は0点から積み上げ、停止時は全点表示へ戻す
  useEffect(() => {
    const demo = demoRef.current;
    demo.active = !!demoMode;
    const st = stateRef.current;
    if (demoMode) {
      demo.start = performance.now();
      st?.points?.geometry.setDrawRange(0, 0);
    } else {
      st?.points?.geometry.setDrawRange(0, Infinity);
      if (st?.scanPlane) st.scanPlane.visible = false;
    }
  }, [demoMode]);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 5 }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {demoMode && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            padding: "4px 10px",
            background: "rgba(74, 144, 226, 0.85)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 6,
          }}
        >
          デモ再生中: 走査計測シミュレーション
        </div>
      )}
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
