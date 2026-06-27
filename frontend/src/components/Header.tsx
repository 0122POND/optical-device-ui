import { useEffect, useRef, useState } from "react";
import { colors } from "../utils/constants";
import { StatusBadge } from "./StatusBadge";
import type { MeasureStatus } from "../types";

// アプリ上部のヘッダー（ロゴ＋About／タイトル／最新撮影日時・測定回数・ステータス）
export function Header({
  lastMeasuredAt,
  measureCount,
  status,
}: {
  lastMeasuredAt: string | null;
  measureCount: number;
  status: MeasureStatus;
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

  return (
    <div
      style={{
        height: "48px",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        backgroundColor: "#6b737e",
        borderBottom: `1px solid ${colors.border}`,
        boxSizing: "border-box",
        gap: "10px",
      }}
    >
      <div
        ref={aboutRef}
        style={{ position: "relative" }}
        onClick={() => setShowAbout((prev) => !prev)}
      >
        <img
          src="/logo.jpg"
          alt="Company Logo"
          style={{ height: "28px", width: "auto", opacity: 0.95, cursor: "pointer" }}
        />

        {/* About Us ポップアップ */}
        {showAbout && (
          <div
            style={{
              position: "absolute",
              top: "36px",
              left: "0",
              width: "280px",
              padding: "16px",
              backgroundColor: "#565d68",
              border: `1px solid ${colors.borderLight}`,
              borderRadius: "8px",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
              zIndex: 100,
            }}
          >
            <div
              style={{
                fontSize: "14px",
                fontWeight: 600,
                marginBottom: "10px",
                color: "#ffffff",
              }}
            >
              About Us
            </div>
            <div style={{ fontSize: "12px", color: "#ffffff", lineHeight: 1.6 }}>
              光学デバイスから取得した3次元面形状をブラウザで可視化するWebアプリケーションです。
            </div>
            <div
              style={{
                marginTop: "12px",
                paddingTop: "10px",
                borderTop: `1px solid ${colors.borderLight}`,
                fontSize: "11px",
                color: "#ffffffcc",
              }}
            >
              <div>Version: 0.1.0</div>
              <div style={{ marginTop: "4px" }}>© 2026 Trillion Technology</div>
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          fontFamily: '"Orbitron", sans-serif',
          fontWeight: 700,
          fontSize: "18px",
          letterSpacing: "2px",
          textTransform: "uppercase",
        }}
      >
        Tori-Ton UI
      </div>

      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        {lastMeasuredAt && (
          <div
            style={{
              fontSize: "11px",
              color: "#ffffff",
              textAlign: "right",
              lineHeight: 1.3,
            }}
          >
            <div>最新撮影日時</div>
            <div>{lastMeasuredAt}</div>
          </div>
        )}

        <div
          style={{
            fontSize: "11px",
            color: "#ffffff",
            textAlign: "right",
            lineHeight: 1.3,
          }}
        >
          <div>測定回数</div>
          <div>{measureCount}</div>
        </div>

        <StatusBadge status={status} />
      </div>
    </div>
  );
}
