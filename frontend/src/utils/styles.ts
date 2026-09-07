import type { CSSProperties } from "react";
import { colors, fontFamily } from "./constants";

// サイドパネルなどで共有する入力・ボタンのスタイル

export const inputStyle: CSSProperties = {
  height: "44px",
  padding: "8px 12px",
  borderRadius: "6px",
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgDark,
  color: colors.text,
  fontSize: "13px",
  fontFamily: fontFamily,
  outline: "none",
  transition: "border-color 0.2s",
};

export const unitSelectStyle: CSSProperties = {
  height: "44px",
  padding: "0 12px",
  borderRadius: "6px",
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgDark,
  color: colors.text,
  fontSize: "13px",
  fontFamily: fontFamily,
  cursor: "pointer",
  outline: "none",
};

export const buttonPrimaryStyle: CSSProperties = {
  height: "44px",
  borderRadius: "8px",
  border: "none",
  backgroundColor: colors.primary,
  color: colors.text,
  fontSize: "14px",
  fontWeight: 600,
  fontFamily: fontFamily,
  cursor: "pointer",
  transition: "background-color 0.2s, opacity 0.2s",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 12px",
  boxSizing: "border-box",
};

export const buttonSecondaryStyle: CSSProperties = {
  height: "44px",
  borderRadius: "6px",
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgDark,
  color: colors.text,
  fontSize: "13px",
  fontWeight: 500,
  fontFamily: fontFamily,
  cursor: "pointer",
  transition: "background-color 0.2s",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  padding: "0 12px",
  boxSizing: "border-box",
};

// ---------------------------------------------------------------------------
// 操作パネルのボタンは役割で3種類に分ける（色数を抑え「青い塗り＝処理が走る」を統一ルールにする）
//   実行     : 重い処理を開始する（CPU / GPU / AI計測）。パネル内で唯一の強調色（primary 塗りつぶし）
//   ファイル : 読む・書く（CSV出力 / CSV読込 / マスク読込）。落ち着いた濃色＋枠線
//   トグル   : 表示の切替（軸 / 反転 / 距離計測 / 寸法 / 断層 / 自動回転）。OFF はゴースト、ON は primary の薄い塗り
// ---------------------------------------------------------------------------

/** 有効/無効の共通表現（無効は薄くして not-allowed カーソル） */
export function enabledStateStyle(enabled: boolean): CSSProperties {
  return {
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.4,
  };
}

export const buttonRunStyle: CSSProperties = {
  ...buttonSecondaryStyle,
  backgroundColor: colors.primary,
  border: "none",
  color: colors.text,
  fontSize: "12px",
  fontWeight: 600,
};

export const buttonFileStyle: CSSProperties = {
  ...buttonSecondaryStyle,
  backgroundColor: colors.bgDark,
  border: `1px solid ${colors.borderLight}`,
  color: colors.text,
  fontSize: "12px",
};

/** 表示トグル。ON の見た目はアルゴリズム選択の選択中ボタンと揃える */
export function buttonToggleStyle(on: boolean, enabled: boolean): CSSProperties {
  // 無効中は ON でも強調しない（データ未読込時に軸ボタンだけ光るのを避ける）
  const active = on && enabled;
  return {
    ...buttonSecondaryStyle,
    backgroundColor: active ? colors.primary + "33" : "transparent",
    border: `1px solid ${active ? colors.primary : colors.border}`,
    color: active ? colors.primary : colors.text,
    fontSize: "12px",
    fontWeight: active ? 600 : 500,
    ...enabledStateStyle(enabled),
  };
}
