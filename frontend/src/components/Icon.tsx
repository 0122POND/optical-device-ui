import type { ReactNode } from "react";

// 線画アイコンの共通ラッパー（24×24 の viewBox に path 等を子要素で渡す）
export function Icon({
  children,
  size = 16,
  color = "currentColor",
}: {
  children: ReactNode;
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "none" }}
    >
      {children}
    </svg>
  );
}
