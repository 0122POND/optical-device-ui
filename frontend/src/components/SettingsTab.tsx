import { colors } from "../utils/constants";
import { DEFAULT_UM_PER_PIXEL_X, DEFAULT_UM_PER_PIXEL_Y } from "../utils/constants";
import { inputStyle } from "../utils/styles";

// サイドパネル「設定」タブ：掃引間隔・X/Y軸の µm/pix 換算係数・カラーレンジの入力
export function SettingsTab({
  sweepInterval,
  setSweepInterval,
  umPerPixelXInput,
  setUmPerPixelXInput,
  umPerPixelYInput,
  setUmPerPixelYInput,
  colorRangeMin,
  setColorRangeMin,
  colorRangeMax,
  setColorRangeMax,
}: {
  sweepInterval: string;
  setSweepInterval: (v: string) => void;
  umPerPixelXInput: string;
  setUmPerPixelXInput: (v: string) => void;
  umPerPixelYInput: string;
  setUmPerPixelYInput: (v: string) => void;
  colorRangeMin: string;
  setColorRangeMin: (v: string) => void;
  colorRangeMax: string;
  setColorRangeMax: (v: string) => void;
}) {
  return (
    <>
      {/* 掃引間隔 */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <label style={{ fontSize: "13px", color: colors.textMuted }}>掃引間隔</label>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="入力してください"
            value={sweepInterval}
            onChange={(e) => setSweepInterval(e.target.value)}
            style={{
              ...inputStyle,
              width: "100px",
              height: "32px",
              padding: "4px 10px",
            }}
          />
          <span style={{ fontSize: "13px", color: colors.textMuted }}>µm</span>
        </div>
      </div>

      {/* X軸 µm/pix */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <label style={{ fontSize: "13px", color: colors.textMuted }}>X軸 µm/pix（深さ方向）</label>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <input
            type="text"
            placeholder={String(DEFAULT_UM_PER_PIXEL_X)}
            value={umPerPixelXInput}
            onChange={(e) => setUmPerPixelXInput(e.target.value)}
            style={{
              ...inputStyle,
              width: "100px",
              height: "32px",
              padding: "4px 10px",
            }}
          />
          <span style={{ fontSize: "13px", color: colors.textMuted }}>µm/pix</span>
        </div>
      </div>

      {/* Y軸 µm/pix */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <label style={{ fontSize: "13px", color: colors.textMuted }}>Y軸 µm/pix（縦方向）</label>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <input
            type="text"
            placeholder={String(DEFAULT_UM_PER_PIXEL_Y)}
            value={umPerPixelYInput}
            onChange={(e) => setUmPerPixelYInput(e.target.value)}
            style={{
              ...inputStyle,
              width: "100px",
              height: "32px",
              padding: "4px 10px",
            }}
          />
          <span style={{ fontSize: "13px", color: colors.textMuted }}>µm/pix</span>
        </div>
      </div>

      {/* ヒートマップのカラーレンジ（深さ） */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <label style={{ fontSize: "13px", color: colors.textMuted }}>
          カラーレンジ（深さ, 空欄=自動）
        </label>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <input
            type="text"
            placeholder="min"
            value={colorRangeMin}
            onChange={(e) => setColorRangeMin(e.target.value)}
            style={{
              ...inputStyle,
              width: "72px",
              height: "32px",
              padding: "4px 10px",
            }}
          />
          <span style={{ fontSize: "13px", color: colors.textMuted }}>〜</span>
          <input
            type="text"
            placeholder="max"
            value={colorRangeMax}
            onChange={(e) => setColorRangeMax(e.target.value)}
            style={{
              ...inputStyle,
              width: "72px",
              height: "32px",
              padding: "4px 10px",
            }}
          />
          <span style={{ fontSize: "13px", color: colors.textMuted }}>µm</span>
        </div>
        <div style={{ fontSize: "11px", color: colors.textMuted, lineHeight: 1.5 }}>
          範囲外の点はグレー表示。自動時は外れ値を除いた範囲で色付けします。
        </div>
      </div>
    </>
  );
}
