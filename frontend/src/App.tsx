import { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";
import "./App.css";

function App() {
  const plotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!plotRef.current) return;

    // 簡単なサンプル高さデータ（3x3 のグリッド）
    const zData = [
      [0, 1, 2],
      [1, 2, 3],
      [2, 3, 4],
    ];

    // 型はいったん "any" 扱いでOK
    const data = [
      {
        z: zData,
        type: "surface" as const,
      },
    ];

    const layout = {
      title: "Sample 3D Surface",
      autosize: true,
      scene: {
        xaxis: { title: "X" },
        yaxis: { title: "Y" },
        zaxis: { title: "Height" },
      },
    };

    // TypeScript に「細かい型は気にしないでOK」と教える
    Plotly.newPlot(plotRef.current, data as any, layout as any);

    return () => {
      if (plotRef.current) {
        Plotly.purge(plotRef.current);
      }
    };
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        overflow: "hidden",
      }}
    >
      <div ref={plotRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

export default App;
