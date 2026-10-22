import type { CSSProperties } from "react";
import { colors, fontFamily, monoFont } from "./constants";

// サイドパネル・ツールバー・ダイアログで共有するスタイル。
// ボタンは役割で分ける（強調色 primary の塗りは「計測開始」だけ）:
//   主ボタン   : 計測開始・ダイアログの「はい」。primary 塗り
//   副ボタン   : AI計測など、主ではないが独立した操作。持ち上げた面＋枠線
//   ファイル   : 読む・書く（CSV読込 / マスク読込 / CSV出力）。ゴースト＋枠線の小ボタン
//   ツール     : 表示・計測の切替（軸 / 反転 / 自動回転 / 距離 / 寸法 / 断層）。アイコン＋ラベル、ON は primary の薄い塗り
//   セグメント : 二者択一（描画モード / エンジン / CPU・GPU / タブ）

export const inputStyle: CSSProperties = {
  height: "38px",
  padding: "0 12px",
  borderRadius: "8px",
  border: `1px solid ${colors.borderLight}`,
  backgroundColor: colors.bgDark,
  color: colors.text,
  fontSize: "13px",
  fontFamily: monoFont,
  outline: "none",
  transition: "border-color 0.2s",
};

export const unitSelectStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: fontFamily,
  cursor: "pointer",
};

/** 有効/無効の共通表現（無効は薄くして not-allowed カーソル） */
export function enabledStateStyle(enabled: boolean): CSSProperties {
  return {
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.35,
  };
}

const buttonBase: CSSProperties = {
  borderRadius: "8px",
  fontFamily: fontFamily,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  padding: "0 12px",
  boxSizing: "border-box",
  whiteSpace: "nowrap",
};

export const buttonPrimaryStyle: CSSProperties = {
  ...buttonBase,
  height: "44px",
  border: "none",
  backgroundColor: colors.primary,
  color: colors.onPrimary,
  fontSize: "14px",
  fontWeight: 600,
  boxShadow: `0 6px 20px -10px ${colors.primary}`,
};

export const buttonSecondaryStyle: CSSProperties = {
  ...buttonBase,
  height: "38px",
  border: `1px solid ${colors.borderLight}`,
  backgroundColor: colors.bgLight,
  color: colors.text,
  fontSize: "13px",
  fontWeight: 500,
};

export const buttonFileStyle: CSSProperties = {
  ...buttonBase,
  height: "34px",
  padding: "0 8px",
  gap: "6px",
  border: `1px solid ${colors.border}`,
  backgroundColor: "transparent",
  color: colors.text,
  fontSize: "12px",
  fontWeight: 500,
};

/** ツールボタン（アイコンの下にラベル）。ON は primary の薄い塗り＋枠 */
export function toolButtonStyle(on: boolean, enabled: boolean): CSSProperties {
  // 無効中は ON でも強調しない（データ未読込時に軸ボタンだけ光るのを避ける）
  const active = on && enabled;
  return {
    ...buttonBase,
    height: "58px",
    padding: "0 4px",
    flexDirection: "column",
    gap: "5px",
    border: `1px solid ${active ? colors.primary + "80" : colors.border}`,
    backgroundColor: active ? colors.primarySoft : "transparent",
    color: active ? colors.primary : colors.textMuted,
    fontSize: "11.5px",
    fontWeight: 500,
    ...enabledStateStyle(enabled),
  };
}

/** セグメント（二者択一）の溝 */
export const segmentGroupStyle: CSSProperties = {
  display: "flex",
  gap: "2px",
  padding: "3px",
  borderRadius: "8px",
  backgroundColor: colors.bgDark,
  border: `1px solid ${colors.border}`,
};

/** セグメントのボタン。選択中は持ち上げた面 */
export function segmentButtonStyle(on: boolean, height = 28): CSSProperties {
  return {
    flex: 1,
    height: `${height}px`,
    padding: "0 10px",
    border: "none",
    borderRadius: "6px",
    backgroundColor: on ? colors.bgLight : "transparent",
    boxShadow: on ? `inset 0 0 0 1px ${colors.borderLight}` : "none",
    color: on ? colors.text : colors.textMuted,
    fontSize: "12px",
    fontWeight: 500,
    fontFamily: fontFamily,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    whiteSpace: "nowrap",
  };
}

/** サイドパネルの区画見出し（等幅・大文字・小さめ） */
export const sectionTitleStyle: CSSProperties = {
  margin: "0 0 10px",
  fontFamily: monoFont,
  fontSize: "11px",
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: colors.textDim,
};

/** 設定の1行（ラベル左・切替右） */
export const settingRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
};

/** 設定行のラベル */
export const rowLabelStyle: CSSProperties = {
  fontSize: "12px",
  color: colors.textMuted,
};

/** サイドパネルの区画（区画間は細い罫線） */
export const panelSectionStyle: CSSProperties = {
  padding: "14px 0",
  borderBottom: `1px solid ${colors.border}`,
};

/** プロット上に浮かべるツールバーのグループ */
export const floatingGroupStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "2px",
  padding: "3px",
  borderRadius: "10px",
  backgroundColor: "rgba(22, 27, 34, 0.86)",
  border: `1px solid ${colors.border}`,
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
};

/** ツールバーのアイコンボタン */
export function iconButtonStyle(active = false): CSSProperties {
  return {
    width: "32px",
    height: "30px",
    padding: 0,
    border: "none",
    borderRadius: "7px",
    backgroundColor: active ? colors.primarySoft : "transparent",
    color: active ? colors.primary : colors.textMuted,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

export const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(4, 6, 9, 0.6)",
  backdropFilter: "blur(2px)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 1000,
};

export const modalCardStyle: CSSProperties = {
  backgroundColor: colors.surface,
  border: `1px solid ${colors.borderLight}`,
  borderRadius: "12px",
  padding: "20px 22px",
  boxShadow: "0 24px 60px rgba(0, 0, 0, 0.5)",
  boxSizing: "border-box",
  color: colors.text,
};

/** ダイアログのボタン（primary=はい / neutral=いいえ・閉じる / danger=削除） */
export function modalButtonStyle(kind: "primary" | "neutral" | "danger"): CSSProperties {
  return {
    ...buttonBase,
    height: "36px",
    padding: "0 18px",
    border: kind === "neutral" ? `1px solid ${colors.borderLight}` : "none",
    backgroundColor:
      kind === "primary" ? colors.primary : kind === "danger" ? colors.danger : colors.bgLight,
    color: kind === "primary" ? colors.onPrimary : kind === "danger" ? "#1a0b06" : colors.text,
    fontSize: "13px",
    fontWeight: kind === "neutral" ? 500 : 600,
  };
}
