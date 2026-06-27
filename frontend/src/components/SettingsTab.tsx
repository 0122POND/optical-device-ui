import { colors } from "../utils/constants";
import { DEFAULT_UM_PER_PIXEL_X, DEFAULT_UM_PER_PIXEL_Y } from "../utils/constants";
import { inputStyle, unitSelectStyle } from "../utils/styles";

// サイドパネル「設定」タブ：掃引間隔・X/Y軸の µm/pix 換算係数の入力
export function SettingsTab({
  sweepInterval,
  setSweepInterval,
  sweepIntervalUnit,
  setSweepIntervalUnit,
  umPerPixelXInput,
  setUmPerPixelXInput,
  umPerPixelYInput,
  setUmPerPixelYInput,
}: {
  sweepInterval: string;
  setSweepInterval: (v: string) => void;
  sweepIntervalUnit: "um" | "mm";
  setSweepIntervalUnit: (v: "um" | "mm") => void;
  umPerPixelXInput: string;
  setUmPerPixelXInput: (v: string) => void;
  umPerPixelYInput: string;
  setUmPerPixelYInput: (v: string) => void;
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
          <select
            value={sweepIntervalUnit}
            onChange={(e) => setSweepIntervalUnit(e.target.value as "um" | "mm")}
            style={{ ...unitSelectStyle, height: "32px", padding: "4px 8px" }}
          >
            <option value="um">µm</option>
            <option value="mm">mm</option>
          </select>
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
    </>
  );
}
