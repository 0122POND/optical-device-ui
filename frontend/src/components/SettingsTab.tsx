import type { ReactNode } from "react";
import { colors, monoFont } from "../utils/constants";
import { DEFAULT_UM_PER_PIXEL_X, DEFAULT_UM_PER_PIXEL_Y } from "../utils/constants";
import { inputStyle, panelSectionStyle, sectionTitleStyle } from "../utils/styles";
import type { DataSource } from "../utils/units";

// 入力欄1行（ラベル → 入力＋単位）
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label style={{ fontSize: "12px", color: colors.textMuted }}>{label}</label>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>{children}</div>
    </div>
  );
}

const unit = (text: string) => (
  <span style={{ fontFamily: monoFont, fontSize: "12px", color: colors.textDim }}>{text}</span>
);

const fieldInput = (width: number) => ({ ...inputStyle, width: `${width}px`, height: "34px" });

// 表示中データにどちらの設定が効いているかを示す小さな印
function ActiveBadge() {
  return (
    <span
      style={{
        marginLeft: "8px",
        padding: "1px 6px",
        borderRadius: "4px",
        backgroundColor: colors.primarySoft,
        color: colors.primary,
        letterSpacing: 0,
        textTransform: "none",
      }}
    >
      表示中
    </span>
  );
}

// サイドパネル「設定」タブ：掃引間隔・X/Y軸の µm/pix 換算係数・カラーレンジの入力
export function SettingsTab({
  sweepInterval,
  setSweepInterval,
  umPerPixelXInput,
  setUmPerPixelXInput,
  umPerPixelYInput,
  setUmPerPixelYInput,
  csvPitchXInput,
  setCsvPitchXInput,
  csvPitchYInput,
  setCsvPitchYInput,
  dataSource,
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
  csvPitchXInput: string;
  setCsvPitchXInput: (v: string) => void;
  csvPitchYInput: string;
  setCsvPitchYInput: (v: string) => void;
  // 表示中データの出どころ（null=データなし）。どちらの設定が効いているかを示す
  dataSource: DataSource | null;
  colorRangeMin: string;
  setColorRangeMin: (v: string) => void;
  colorRangeMax: string;
  setColorRangeMax: (v: string) => void;
}) {
  return (
    <>
      <section style={panelSectionStyle}>
        <h3 style={sectionTitleStyle}>
          デバイス（干渉画像）{dataSource === "device" && <ActiveBadge />}
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <Field label="掃引間隔">
            <input
              type="text"
              placeholder="入力してください"
              value={sweepInterval}
              onChange={(e) => setSweepInterval(e.target.value)}
              style={fieldInput(110)}
            />
            {unit("µm")}
          </Field>

          <Field label="X軸 µm/pix（深さ方向）">
            <input
              type="text"
              placeholder={String(DEFAULT_UM_PER_PIXEL_X)}
              value={umPerPixelXInput}
              onChange={(e) => setUmPerPixelXInput(e.target.value)}
              style={fieldInput(110)}
            />
            {unit("µm/pix")}
          </Field>

          <Field label="Y軸 µm/pix（縦方向）">
            <input
              type="text"
              placeholder={String(DEFAULT_UM_PER_PIXEL_Y)}
              value={umPerPixelYInput}
              onChange={(e) => setUmPerPixelYInput(e.target.value)}
              style={fieldInput(110)}
            />
            {unit("µm/pix")}
          </Field>
        </div>
      </section>

      <section style={panelSectionStyle}>
        <h3 style={sectionTitleStyle}>
          CSV（高さマップ）{dataSource === "csv" && <ActiveBadge />}
        </h3>
        <Field label="ピッチ X / Y（列 / 行）">
          <input
            type="text"
            placeholder="10"
            value={csvPitchXInput}
            onChange={(e) => setCsvPitchXInput(e.target.value)}
            style={fieldInput(84)}
          />
          <span style={{ color: colors.textDim }}>/</span>
          <input
            type="text"
            placeholder="10"
            value={csvPitchYInput}
            onChange={(e) => setCsvPitchYInput(e.target.value)}
            style={fieldInput(84)}
          />
          {unit("µm/px")}
        </Field>
        <div
          style={{ marginTop: "8px", fontSize: "11.5px", color: colors.textDim, lineHeight: 1.6 }}
        >
          CSV の値は高さ[µm]として扱います。目安: 自社デバイス 10 / WI5000 約37.4 / Keyence
          約32.9。このアプリで書き出した CSV はファイル名のピッチを自動で読み込みます。
        </div>
      </section>

      <section style={{ ...panelSectionStyle, borderBottom: "none" }}>
        <h3 style={sectionTitleStyle}>カラーレンジ</h3>
        <Field label="深さ（空欄=自動）">
          <input
            type="text"
            placeholder="min"
            value={colorRangeMin}
            onChange={(e) => setColorRangeMin(e.target.value)}
            style={fieldInput(84)}
          />
          <span style={{ color: colors.textDim }}>〜</span>
          <input
            type="text"
            placeholder="max"
            value={colorRangeMax}
            onChange={(e) => setColorRangeMax(e.target.value)}
            style={fieldInput(84)}
          />
          {unit("µm")}
        </Field>
        <div
          style={{ marginTop: "8px", fontSize: "11.5px", color: colors.textDim, lineHeight: 1.6 }}
        >
          手動で指定した範囲の外はグレー表示。自動時は外れ値を除いた範囲で色付けし、外れ値は端の色（赤・青）で塗ります。
        </div>
      </section>
    </>
  );
}
