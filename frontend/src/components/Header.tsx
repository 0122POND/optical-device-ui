import { useEffect, useRef, useState } from "react";
import { colors, displayFont, monoFont } from "../utils/constants";
import { StatusBadge } from "./StatusBadge";
import type { MeasureStatus } from "../types";

// アプリ上部のヘッダー（ロゴ＋About／タイトル／最新撮影日時・測定回数・ステータス）
export function Header({
  lastMeasuredAt,
  measureCount,
  status,
  data,
}: {
  lastMeasuredAt: string | null;
  measureCount: number;
  status: MeasureStatus;
  // 表示中データの概要（名前・グリッドサイズ・有効率）。未表示なら null
  data:
    | { name: string | null; w: number; h: number; validPct: number }
    | { name: string | null; points: number }
    | null;
}) {
  // About Usポップアップ表示フラグ
  const [showAbout, setShowAbout] = useState(false);
  const aboutRef = useRef<HTMLDivElement>(null);

  // About Usポップアップ外クリックで閉じる
  useEffect(() => {
    if (!showAbout) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (aboutRef.current && !aboutRef.current.contains(e.target as Node)) {
        setShowAbout(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showAbout]);

  // 右側の数値表示（ラベルは小さく、値は等幅）
  const stat = (label: string, value: string | number) => (
    <div style={{ textAlign: "right", lineHeight: 1.3 }}>
      <div style={{ fontSize: "10.5px", color: colors.textDim }}>{label}</div>
      <div
        style={{
          fontFamily: monoFont,
          fontSize: "12.5px",
          fontWeight: 500,
          color: colors.text,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );

  return (
    <div
      style={{
        height: "52px",
        display: "flex",
        alignItems: "center",
        padding: "0 18px",
        backgroundColor: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
        boxSizing: "border-box",
        gap: "12px",
      }}
    >
      <div
        ref={aboutRef}
        style={{ position: "relative" }}
        onClick={() => setShowAbout((prev) => !prev)}
      >
        {/* ロゴ（暗い背景用に白地を抜いた版。元画像は /logo.jpg） */}
        <img
          src="/logo-dark.png"
          alt="Company Logo"
          style={{ width: "30px", height: "30px", display: "block", cursor: "pointer" }}
        />

        {/* About Us ポップアップ */}
        {showAbout && (
          <div
            style={{
              position: "absolute",
              top: "40px",
              left: "0",
              width: "280px",
              padding: "16px",
              backgroundColor: colors.surface,
              border: `1px solid ${colors.borderLight}`,
              borderRadius: "10px",
              boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45)",
              zIndex: 100,
            }}
          >
            <div
              style={{
                fontSize: "14px",
                fontWeight: 600,
                marginBottom: "10px",
                color: colors.text,
              }}
            >
              About Us
            </div>
            <div style={{ fontSize: "12px", color: colors.textMuted, lineHeight: 1.7 }}>
              光学デバイスから取得した3次元面形状をブラウザで可視化するWebアプリケーションです。
            </div>
            <div
              style={{
                marginTop: "12px",
                paddingTop: "10px",
                borderTop: `1px solid ${colors.border}`,
                fontFamily: monoFont,
                fontSize: "11px",
                color: colors.textDim,
              }}
            >
              <div>Version: 0.1.0</div>
              <div style={{ marginTop: "4px" }}>© 2026 Trillion Technology</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ lineHeight: 1.1 }}>
        <div
          style={{
            fontFamily: displayFont,
            fontWeight: 600,
            fontSize: "17px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: colors.text,
          }}
        >
          Tori-Ton
        </div>
        <div
          style={{
            fontFamily: monoFont,
            fontSize: "10px",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: colors.textDim,
            marginTop: "2px",
          }}
        >
          Optical Surface Profiler
        </div>
      </div>

      {/* 表示中データ */}
      {data && (
        <div
          style={{
            marginLeft: "8px",
            paddingLeft: "18px",
            borderLeft: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: colors.textMuted,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flex: "none" }}
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          {data.name && (
            <span
              style={{
                color: colors.text,
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {data.name}
            </span>
          )}
          <span style={{ fontFamily: monoFont }}>
            {data.name ? "· " : ""}
            {"points" in data
              ? `点群 ${data.points.toLocaleString()} 点`
              : `${data.w} × ${data.h} · 有効 ${data.validPct.toFixed(1)}%`}
          </span>
        </div>
      )}

      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: "22px",
        }}
      >
        {lastMeasuredAt && stat("最新撮影", lastMeasuredAt.replace(/:\d{2}$/, ""))}
        {stat("測定回数", measureCount)}
        <StatusBadge status={status} />
      </div>
    </div>
  );
}
