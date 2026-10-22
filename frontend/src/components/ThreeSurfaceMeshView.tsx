import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  MESH_COLORMAPS,
  buildTriangleIndex,
  detrendHeights,
  gridToHeights,
  niceStep,
  percentileOf,
  type Detrend,
  type MeshColormap,
} from "../utils/surfaceMesh";

// 自動回転の角速度[°/s]（15°/s ≒ 24秒で1周。Plotly側の usePlotlyAutoRotate と揃える）
const SPIN_DEG_PER_SEC = 15;
// 手動操作をやめてから自動回転に戻るまでの秒数
const RESUME_AFTER_SEC = 4;

type MeshViewState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  material: THREE.MeshPhongMaterial;
  uniforms: { uContour: { value: number }; uContourStep: { value: number } };
  mesh?: THREE.Mesh;
  // 自動回転カメラ（方位角・仰角・距離を球座標で持つ）
  cam: { az: number; el: number; dist: number; target: THREE.Vector3 };
  auto: boolean;
  homeDist: number;
};

// three.js による Surface のメッシュ表示（Plotly surface の代替）。
// ジオメトリは grid / 前処理 / 色が変わったときだけ作り直し、z強調は mesh.scale.z、
// 等高線はシェーダの uniform で切り替える（再構築なしなので数百万三角形でもなめらか）。
// grid は高さ[µm]、pitchX/pitchY は列・行方向の間隔[µm]。
export function ThreeSurfaceMeshView(props: {
  grid: (number | null)[][] | null;
  pitchX: number;
  pitchY: number;
  // カラーレンジの手動指定（µm, 空文字=自動）。前処理後の高さに対して適用する
  colorRangeMin: string;
  colorRangeMax: string;
  autoRotate?: boolean;
  // パネルの「自動回転」チェックから App 側の自動回転状態を切り替える（ツールバーと連動）
  onAutoRotateChange?: (on: boolean) => void;
}) {
  const { grid, pitchX, pitchY, colorRangeMin, colorRangeMax, autoRotate, onAutoRotateChange } =
    props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const colorbarRef = useRef<HTMLCanvasElement | null>(null);
  const [zEx, setZEx] = useState(5);
  const [cmap, setCmap] = useState<MeshColormap>("turbo");
  const [detrend, setDetrend] = useState<Detrend>("plane");
  const [contour, setContour] = useState(false);
  const [flipZ, setFlipZ] = useState(false);
  const [legend, setLegend] = useState<{ lo: number; hi: number; tris: number } | null>(null);

  const stateRef = useRef<MeshViewState | null>(null);
  // 描画ループ（マウント時に1回だけ生成）から最新値を読むための ref
  const rotateRef = useRef(false);
  rotateRef.current = !!autoRotate;
  const zExRef = useRef(zEx);
  zExRef.current = zEx;

  // 初期化（マウント時に1回）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
    renderer.setClearColor(0x000000, 1);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      30,
      (container.clientWidth || 1) / (container.clientHeight || 1),
      1,
      1e7
    );
    scene.add(camera);
    // カメラ固定ライト（VTK風）: どこから見ても陰影の調子が変わらない
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    for (const [p, i] of [
      [[1, 1, 1], 2.2],
      [[-1, -0.5, 0.5], 0.9],
      [[0, 0.3, -1], 0.5],
    ] as const) {
      const l = new THREE.DirectionalLight(0xffffff, i);
      l.position.set(p[0], p[1], p[2]);
      camera.add(l);
      camera.add(l.target);
    }
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // 等高線は onBeforeCompile でフラグメントシェーダに差し込む（ジオメトリ再生成なし）
    const uniforms = { uContour: { value: 0 }, uContourStep: { value: 1 } };
    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      specular: 0x333333,
      shininess: 30,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aH;\nvarying float vH;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvH = aH;");
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uContour;\nuniform float uContourStep;\nvarying float vH;"
        )
        .replace(
          "#include <dithering_fragment>",
          `#include <dithering_fragment>
          if (uContour > 0.5) {
            float f = vH / uContourStep;
            float d = abs(fract(f - 0.5) - 0.5) / fwidth(f);
            gl_FragColor.rgb = mix(gl_FragColor.rgb * 0.35, gl_FragColor.rgb, clamp(d, 0.0, 1.0));
          }`
        );
    };

    const st: MeshViewState = {
      renderer,
      scene,
      camera,
      controls,
      material,
      uniforms,
      cam: { az: 30, el: 35, dist: 1000, target: new THREE.Vector3() },
      auto: true,
      homeDist: 1000,
    };
    stateRef.current = st;

    const place = () => {
      const { az, el, dist, target } = st.cam;
      const a = (az * Math.PI) / 180;
      const e = (el * Math.PI) / 180;
      camera.position.set(
        target.x + dist * Math.cos(e) * Math.sin(a),
        target.y + dist * Math.sin(e),
        target.z + dist * Math.cos(e) * Math.cos(a)
      );
      camera.lookAt(target);
      controls.target.copy(target);
      camera.near = dist / 200;
      camera.far = dist * 20;
      camera.updateProjectionMatrix();
    };
    // 手動操作後の視点から自動回転を続ける（カメラが跳ばない）
    const takeOver = () => {
      const off = camera.position.clone().sub(controls.target);
      st.cam.dist = off.length();
      st.cam.az = (Math.atan2(off.x, off.z) * 180) / Math.PI;
      st.cam.el = (Math.asin(off.y / st.cam.dist) * 180) / Math.PI;
      st.cam.target.copy(controls.target);
    };
    let dragging = false;
    let idle = 0;
    const onStart = () => {
      st.auto = false;
      dragging = true;
    };
    const onEnd = () => {
      dragging = false;
      idle = 0;
    };
    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);

    let spin = 0; // 回転速度も平滑化して、止まる・動き出すをなめらかにする
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(now) {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (st.mesh) st.mesh.scale.set(1, 1, zExRef.current);
      if (!st.auto) {
        idle += dt;
        controls.update();
        if (rotateRef.current && idle > RESUME_AFTER_SEC && !dragging) {
          takeOver();
          st.auto = true;
          spin = 0;
        }
      }
      if (st.auto) {
        const want = rotateRef.current ? SPIN_DEG_PER_SEC : 0;
        spin += (want - spin) * (1 - Math.exp(-dt / 0.8));
        st.cam.az += spin * dt;
        place();
      }
      renderer.render(scene, camera);
    });

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      controls.dispose();
      st.mesh?.geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.parentNode?.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, []);

  // grid・前処理・色・z反転・カラーレンジ変更時にジオメトリを再構築
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    if (st.mesh) {
      st.scene.remove(st.mesh);
      st.mesh.geometry.dispose();
      st.mesh = undefined;
    }
    if (!grid || grid.length < 2 || grid[0].length < 2) {
      setLegend(null);
      return;
    }

    const { z, w, h } = gridToHeights(grid);
    const heights = detrendHeights(z, w, h, detrend);
    if (flipZ) for (let i = 0; i < heights.length; i++) heights[i] = -heights[i];
    let lo = percentileOf(heights, 0.5);
    let hi = percentileOf(heights, 99.5);
    const mi = parseFloat(colorRangeMin);
    const ma = parseFloat(colorRangeMax);
    if (isFinite(mi)) lo = mi;
    if (isFinite(ma)) hi = ma;
    if (!(hi > lo)) hi = lo + 1;
    const mid = (lo + hi) / 2;
    const sizeX = (w - 1) * pitchX;
    const sizeY = (h - 1) * pitchY;

    // 頂点: x,y,z とも µm。z強調は mesh.scale.z で掛ける（法線は normalMatrix が正しく補正）
    const pos = new Float32Array(w * h * 3);
    const col = new Float32Array(w * h * 3);
    const aH = new Float32Array(w * h);
    const cm = MESH_COLORMAPS[cmap];
    const color = new THREE.Color();
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const k = r * w + c;
        const v = heights[k];
        const ok = !Number.isNaN(v);
        pos[k * 3] = c * pitchX - sizeX / 2;
        pos[k * 3 + 1] = r * pitchY - sizeY / 2;
        pos[k * 3 + 2] = ok ? v - mid : 0;
        aH[k] = ok ? v : 0;
        const [cr, cg, cb] = cm(Math.min(1, Math.max(0, (v - lo) / (hi - lo))));
        // カラーマップは sRGB で定義 → three.js の線形作業空間へ
        color.setRGB(cr, cg, cb, THREE.SRGBColorSpace);
        col[k * 3] = color.r;
        col[k * 3 + 1] = color.g;
        col[k * 3 + 2] = color.b;
      }
    }
    const idx = buildTriangleIndex(heights, w, h);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geom.setAttribute("aH", new THREE.BufferAttribute(aH, 1));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    const mesh = new THREE.Mesh(geom, st.material);
    mesh.rotation.x = -Math.PI / 2; // データの高さを画面の上方向へ
    mesh.scale.set(1, 1, zExRef.current);
    st.scene.add(mesh);
    st.mesh = mesh;
    st.uniforms.uContourStep.value = niceStep((hi - lo) / 15);

    // 寸法が変わったとき（新しいデータ）だけ視点を初期化する
    const home =
      (Math.hypot(sizeX, sizeY) / 2 / Math.sin((st.camera.fov / 2) * (Math.PI / 180))) * 0.95;
    if (Math.abs(home - st.homeDist) / st.homeDist > 1e-6) {
      st.homeDist = home;
      st.cam = { az: 30, el: 35, dist: home, target: new THREE.Vector3() };
      st.auto = true;
    }
    setLegend({ lo, hi, tris: idx.length / 3 });
  }, [grid, pitchX, pitchY, detrend, cmap, flipZ, colorRangeMin, colorRangeMax]);

  useEffect(() => {
    if (stateRef.current) stateRef.current.uniforms.uContour.value = contour ? 1 : 0;
  }, [contour]);

  // カラーバー描画
  useEffect(() => {
    const cv = colorbarRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = MESH_COLORMAPS[cmap](1 - i / 255).map((v) => Math.round(v * 255));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, i, 1, 1);
    }
  }, [cmap, legend]);

  const resetView = () => {
    const st = stateRef.current;
    if (!st) return;
    st.cam = { az: 30, el: 35, dist: st.homeDist, target: new THREE.Vector3() };
    st.auto = true;
  };

  const panel: React.CSSProperties = {
    position: "absolute",
    top: 8,
    left: 8,
    width: 220,
    padding: "10px 12px",
    background: "rgba(20,22,27,0.78)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    color: "#e6e8ec",
    fontSize: 12,
    lineHeight: 1.4,
  };
  const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "6px 0",
  };
  const lbl: React.CSSProperties = { flex: "0 0 56px", color: "#9aa3b2" };
  const sel: React.CSSProperties = {
    flex: 1,
    background: "transparent",
    color: "inherit",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 4,
    fontSize: 12,
  };
  const fmt = (v: number) => `${v.toFixed(1)} µm`;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 5 }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div style={panel}>
        <div style={row}>
          <span style={lbl}>z 強調</span>
          <input
            type="range"
            min={1}
            max={50}
            step={0.5}
            value={zEx}
            onChange={(e) => setZEx(Number(e.target.value))}
            style={{ flex: 1, minWidth: 0 }}
          />
          <span style={{ width: 34, textAlign: "right" }}>{zEx}×</span>
        </div>
        <div style={row}>
          <span style={lbl}>色</span>
          <select
            value={cmap}
            onChange={(e) => setCmap(e.target.value as MeshColormap)}
            style={sel}
          >
            <option value="turbo">高さ（turbo）</option>
            <option value="viridis">高さ（viridis）</option>
            <option value="metal">金属（単色）</option>
          </select>
        </div>
        <div style={row}>
          <span style={lbl}>前処理</span>
          <select
            value={detrend}
            onChange={(e) => setDetrend(e.target.value as Detrend)}
            style={sel}
          >
            <option value="none">なし</option>
            <option value="plane">平面除去</option>
            <option value="quad">2次曲面除去</option>
          </select>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", margin: "8px 0 6px" }}>
          {onAutoRotateChange && (
            <label>
              <input
                type="checkbox"
                checked={!!autoRotate}
                onChange={(e) => onAutoRotateChange(e.target.checked)}
              />{" "}
              自動回転
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={contour}
              onChange={(e) => setContour(e.target.checked)}
            />{" "}
            等高線
          </label>
          <label>
            <input type="checkbox" checked={flipZ} onChange={(e) => setFlipZ(e.target.checked)} /> z
            反転
          </label>
        </div>
        <button
          type="button"
          onClick={resetView}
          style={{
            background: "transparent",
            color: "inherit",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 5,
            padding: "3px 10px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          視点リセット
        </button>
      </div>
      {legend && cmap !== "metal" && (
        <div
          style={{
            position: "absolute",
            right: 12,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            gap: 6,
            height: 220,
            fontSize: 11,
            color: "#b6bdc9",
            fontFamily: "ui-monospace, Menlo, monospace",
          }}
        >
          <canvas
            ref={colorbarRef}
            width={1}
            height={256}
            style={{
              width: 12,
              height: "100%",
              borderRadius: 3,
              border: "1px solid rgba(255,255,255,0.2)",
            }}
          />
          <div
            style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}
          >
            <span>{fmt(legend.hi)}</span>
            <span>{fmt((legend.lo + legend.hi) / 2)}</span>
            <span>{fmt(legend.lo)}</span>
          </div>
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
        three.js メッシュ{legend ? ` / ${legend.tris.toLocaleString()}三角形` : ""}
      </div>
    </div>
  );
}
