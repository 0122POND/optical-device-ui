import { colors, fontFamily } from "../utils/constants";
import type { CloudHistoryEntry, HistorySource, ViewMode } from "../types";
import type { PointCloud } from "../utils/pointCloud";

// サイドパネル「測定結果」タブ：現在の点群情報と測定履歴（リネーム/復元/削除）
export function ResultTab({
  cloud,
  viewMode,
  history,
  editingNameIdx,
  setEditingNameIdx,
  editingNameValue,
  setEditingNameValue,
  renameEntry,
  setDeleteConfirmIdx,
  onRestore,
}: {
  cloud: PointCloud | null;
  viewMode: ViewMode;
  history: CloudHistoryEntry[];
  editingNameIdx: number | null;
  setEditingNameIdx: (v: number | null) => void;
  editingNameValue: string;
  setEditingNameValue: (v: string) => void;
  renameEntry: (index: number, name: string) => void;
  setDeleteConfirmIdx: (v: number | null) => void;
  onRestore: (cloud: PointCloud) => void;
}) {
  return (
    <>
      {cloud ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
            <span style={{ color: colors.textMuted }}>点数</span>
            <span>{cloud.x.length.toLocaleString()} pts</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
            <span style={{ color: colors.textMuted }}>閾値</span>
            <span>{">"} 128</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
            <span style={{ color: colors.textMuted }}>表示モード</span>
            <span>{viewMode === "3D" ? "3D" : "2D"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
            <span style={{ color: colors.textMuted }}>カラー軸</span>
            <span>{viewMode === "2D-camera" ? "X (depth)" : "Z (flipped)"}</span>
          </div>
        </div>
      ) : (
        <div
          style={{
            fontSize: "13px",
            color: colors.textMuted,
            textAlign: "center",
            marginTop: "20px",
          }}
        >
          計測データがありません
        </div>
      )}

      {/* 測定履歴 */}
      {history.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: colors.textMuted,
              marginBottom: "8px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            測定履歴（最新5件）
          </div>
          {(
            ["coin", "coin2", "tgv", "elec", "medical", "semi", "csv", "ai"] as HistorySource[]
          ).map((src) => {
            const entries = history
              .map((e, i) => ({ entry: e, idx: i }))
              .filter(({ entry }) => entry.source === src);
            if (entries.length === 0) return null;
            const srcLabel =
              src === "coin"
                ? "硬貨"
                : src === "coin2"
                  ? "硬貨(別アプローチ)"
                  : src === "tgv"
                    ? "TGV"
                    : src === "elec"
                      ? "エレキ"
                      : src === "medical"
                        ? "医療"
                        : src === "semi"
                          ? "半導体"
                          : "CSVインポート";
            return (
              <div key={src} style={{ marginBottom: "10px" }}>
                <div
                  style={{
                    fontSize: "11px",
                    color: colors.textMuted,
                    marginBottom: "4px",
                  }}
                >
                  {srcLabel}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {entries.map(({ entry, idx: i }) => {
                    const isCurrent = cloud === entry.cloud;
                    return (
                      <div
                        key={entry.measuredAt + i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          backgroundColor: isCurrent ? colors.primary + "22" : colors.bgDark,
                          border: isCurrent
                            ? `1px solid ${colors.primary}`
                            : `1px solid ${colors.border}`,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <img
                            src={entry.thumbnail}
                            alt={`#${history.length - i}`}
                            style={{
                              width: "48px",
                              height: "48px",
                              borderRadius: "4px",
                              border: `1px solid ${colors.border}`,
                              flexShrink: 0,
                            }}
                          />
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "2px",
                            }}
                          >
                            {editingNameIdx === i ? (
                              <input
                                autoFocus
                                value={editingNameValue}
                                onChange={(e) => setEditingNameValue(e.target.value)}
                                onBlur={() => {
                                  renameEntry(i, editingNameValue.trim());
                                  setEditingNameIdx(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                  if (e.key === "Escape") setEditingNameIdx(null);
                                }}
                                placeholder={`#${history.length - i}`}
                                style={{
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  fontFamily,
                                  width: "100px",
                                  padding: "1px 4px",
                                  border: `1px solid ${colors.primary}`,
                                  borderRadius: "3px",
                                  backgroundColor: colors.bgDark,
                                  color: colors.text,
                                  outline: "none",
                                }}
                              />
                            ) : (
                              <span
                                style={{
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                                title="クリックで名前を変更"
                                onClick={() => {
                                  setEditingNameIdx(i);
                                  setEditingNameValue(entry.name);
                                }}
                              >
                                {entry.name || `#${history.length - i}`}
                              </span>
                            )}
                            <span style={{ fontSize: "11px", color: colors.textMuted }}>
                              {entry.measuredAt}
                            </span>
                            <span style={{ fontSize: "11px", color: colors.textMuted }}>
                              {entry.points.toLocaleString()} pts
                            </span>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                          {isCurrent ? (
                            <span
                              style={{
                                fontSize: "11px",
                                color: colors.primary,
                                fontWeight: 600,
                              }}
                            >
                              表示中
                            </span>
                          ) : (
                            <button
                              style={{
                                padding: "4px 10px",
                                fontSize: "11px",
                                fontWeight: 600,
                                fontFamily,
                                border: `1px solid ${colors.primary}`,
                                borderRadius: "4px",
                                backgroundColor: "transparent",
                                color: colors.primary,
                                cursor: "pointer",
                              }}
                              onClick={() => onRestore(entry.cloud)}
                            >
                              復元
                            </button>
                          )}
                          <button
                            style={{
                              padding: "4px 10px",
                              fontSize: "11px",
                              fontWeight: 600,
                              fontFamily,
                              border: `1px solid ${colors.danger}`,
                              borderRadius: "4px",
                              backgroundColor: "transparent",
                              color: colors.danger,
                              cursor: "pointer",
                            }}
                            onClick={() => setDeleteConfirmIdx(i)}
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
