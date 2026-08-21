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
