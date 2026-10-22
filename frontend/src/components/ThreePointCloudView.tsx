import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { colorForValue, resolveColorRange } from "../utils/colorRange";
import type { PointCloud } from "../utils/pointCloud";
import type { ViewPresetRequest } from "../types";
import { physicalPoints, type DataSource, type ScaleInputs } from "../utils/units";

// 自動回転の速さ（OrbitControls.autoRotateSpeed 単位。2.0 ≒ 60fpsで1周30秒）
const AUTO_ROTATE_SPEED = 2.5;

// 深さ配列に対しカラーレンジ（手動 or 自動ロバスト）を解決し、色バッファへ
// 書き込む（手動で指定した側のレンジ外だけグレー）
// 信頼度（AI の確率 0〜255 を 0〜1 に）で色バッファを塗る
function fillConfidence(c: number[], arr: Float32Array) {
  for (let i = 0; i < c.length; i++) {
    const [r, g, b] = colorForValue(c[i] / 255, 0, 1);
    arr[i * 3] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
  }
}

function fillColors(depthUm: Float64Array, arr: Float32Array, min: string, max: string) {
  const range = resolveColorRange(depthUm, min, max);
  for (let i = 0; i < depthUm.length; i++) {
    const [r, g, b] = colorForValue(depthUm[i], range.lo, range.hi, {
      below: range.grayBelow,
      above: range.grayAbove,
    });
    arr[i * 3] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
  }
}

// three.js による点群ビューア（Plotly版の代替）。数十万〜百万点でも WebGL バッファを
// 一度だけアップロードして描くため、Plotly の scatter3d より遥かに軽い。
export function ThreePointCloudView(props: {
  cloud: PointCloud | null;
  // 出どころと換算設定（µm への換算は utils/units に集約）
  dataSource: DataSource;
  scale: ScaleInputs;
  flipX: boolean;
  flipRef: number;
  // 奥行き軸の見た目の強調倍率（1=Plotly 点群の既定と同じ見え方）。値・色は変えない
  depthExaggeration?: number;
  // 視点のプリセット（正面・側面・上面・既定）
  viewPreset?: ViewPresetRequest;
  // 色分け（confidence は cloud.c = AI の確率で塗る）
  colorBy?: "depth" | "confidence";
  // カラーレンジの手動指定（µm, 空文字=自動）。レンジ外はグレー表示
  colorRangeMin: string;
  colorRangeMax: string;
  isBuilding?: boolean;
  // ターンテーブル自動回転（カメラを注視点まわりに水平周回させる）
  autoRotate?: boolean;
}) {
  const {
    cloud,
    dataSource,
    scale,
    flipX,
    flipRef,
    depthExaggeration = 1,
    viewPreset = null,
    colorBy = "depth",
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
    // 奥行きを横幅と同じ長さに見せる基準倍率（Plotly 点群の既定 aspect x=y=1 と揃える）
    depthBase?: number;
    // 表示上の最大の広がり（カメラのフィットに使う）
    radius?: number;
  } | null>(null);
  // 自動回転の最新状態。描画ループ（マウント時に1回だけ生成）から参照するため ref に持つ
  const rotateRef = useRef(false);
  rotateRef.current = !!autoRotate;
  // カラーレンジの最新値。ジオメトリ再構築effectの依存に入れずに読むための ref
  // （依存に入れるとレンジ入力のたびに再構築＋カメラリセットが起きる）
  const rangeRef = useRef({ min: colorRangeMin, max: colorRangeMax });
  // 奥行き強調の最新値（ジオメトリ再構築 effect の依存に入れずに読むため）
  const depthExRef = useRef(depthExaggeration);
  // 色分けの最新値（ジオメトリ再構築 effect の依存に入れずに読むため）
  const colorByRef = useRef(colorBy);
  colorByRef.current = colorBy;
  depthExRef.current = depthExaggeration;
  rangeRef.current = { min: colorRangeMin, max: colorRangeMax };

  // 初期化（マウント時に1回）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
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
      // 視点プリセットで OrbitControls を作り直すことがあるので、常に最新の controls を使う
      const ctl = stateRef.current?.controls ?? controls;
      ctl.autoRotate = rotateRef.current;
      ctl.autoRotateSpeed = AUTO_ROTATE_SPEED;
      ctl.update();
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
      (stateRef.current?.controls ?? controls).dispose();
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

    // 座標変換（usePlotly の pointGeom と同じ utils/units の換算）
    const pts = physicalPoints(cloud, dataSource, scale, flipX, flipRef);

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
      const xu = pts.xs[i];
      const yu = pts.ys[i];
      const zu = pts.zs[i];
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

    if (colorByRef.current === "confidence") fillConfidence(cloud.c, col);
    else fillColors(depthUm, col, rangeRef.current.min, rangeRef.current.max);

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

    // 奥行き(x)は横幅(y)と同じ長さに見せたうえで強調倍率を掛ける（Plotly 点群と同じ見え方）。
    // 実寸のままだと、奥行きが掃引方向に比べて極端に薄い多層データ（HDD掃引等）で層が重なって見える
    const depthRange = maxXu - minX;
    const depthBase = depthRange > 0 ? Math.max((maxYu - minY) / depthRange, 1e-6) : 1;
    st.depthBase = depthBase;
    points.scale.x = depthBase * depthExRef.current;

    // カメラをデータ範囲にフィット（奥行きは表示上の長さで評価）
    const radius = Math.max(depthRange * points.scale.x, maxYu - minY, maxZu - minZ, 1);
    st.radius = radius;
    st.camera.fov = 50;
    st.camera.up.set(0, 1, 0);
    st.controls.target.set(0, 0, 0);
    st.camera.position.set(radius * 0.8, radius * 0.6, radius * 1.2);
    st.camera.near = radius / 1000;
    st.camera.far = radius * 20;
    st.camera.updateProjectionMatrix();
    st.controls.update();
  }, [cloud, dataSource, scale, flipX, flipRef]);

  // 視点のプリセット。座標は x=奥行き, y=縦方向(列), z=横方向(掃引) なので
  //   正面: 縦方向に沿って見る（横方向×奥行き） / 側面: 横方向に沿って見る（縦方向×奥行き）
  //   上面: 奥行きに沿って見る（横方向×縦方向）
  // 正面・側面・上面は画角を狭めて遠くから見る（ほぼ平行投影になり、層の重なりや高さを比べやすい）。
  // OrbitControls はカメラの up を生成時に固定するため、up を変えるときは作り直す
  useEffect(() => {
    const st = stateRef.current;
    if (!st || !viewPreset || st.radius == null) return;
    const r = st.radius;
    const cam = st.camera;
    let dist: number;
    if (viewPreset.kind === "reset") {
      cam.fov = 50;
      cam.up.set(0, 1, 0);
      cam.position.set(r * 0.8, r * 0.6, r * 1.2);
      dist = r * 1.6;
    } else {
      const p = {
        front: { dir: [0, 1, 0], up: [1, 0, 0] },
        side: { dir: [0, 0, 1], up: [1, 0, 0] },
        top: { dir: [1, 0, 0], up: [0, 0, 1] },
      }[viewPreset.kind];
      cam.fov = 12;
      dist = (r / 2 / Math.tan(((cam.fov / 2) * Math.PI) / 180)) * 1.15;
      cam.up.set(p.up[0], p.up[1], p.up[2]);
      cam.position.set(p.dir[0] * dist, p.dir[1] * dist, p.dir[2] * dist);
    }
    cam.near = dist / 1000;
    cam.far = dist * 20;
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    st.controls.dispose();
    const controls = new OrbitControls(cam, st.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);
    controls.update();
    st.controls = controls;
  }, [viewPreset]);

  // 奥行き強調だけが変わったときはスケールのみ更新（ジオメトリ・カメラは維持）
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.points || st.depthBase == null) return;
    st.points.scale.x = st.depthBase * depthExaggeration;
  }, [depthExaggeration]);

  // カラーレンジ・色分けの変更時は色バッファのみ更新（ジオメトリ・カメラは維持）
  useEffect(() => {
    const st = stateRef.current;
    if (!st?.points || !st.depthUm) return;
    const attr = st.points.geometry.getAttribute("color") as THREE.BufferAttribute;
    if (colorBy === "confidence" && cloud) fillConfidence(cloud.c, attr.array as Float32Array);
    else fillColors(st.depthUm, attr.array as Float32Array, colorRangeMin, colorRangeMax);
    attr.needsUpdate = true;
  }, [colorRangeMin, colorRangeMax, colorBy, cloud]);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 5 }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {isBuilding && (
        <div
          style={{
            position: "absolute",
            // 左上はフローティングツールバーがあるので、その下に出す
            top: 56,
            left: 12,
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
