import { colors, fontFamily, monoFont } from "../utils/constants";
import { panelSectionStyle, sectionTitleStyle } from "../utils/styles";
import type { CloudHistoryEntry, HistorySource, ProcessingInfo, ViewMode } from "../types";
import type { PointCloud } from "../utils/pointCloud";

// サイドパネル「測定結果」タブ：現在の点群情報と測定履歴（リネーム/復元/削除）
export function ResultTab({
  cloud,
  processing,
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
  // 表示中データの処理条件と深さの求め方（計測・推論・マスク読込のとき。CSV では null）
  processing: ProcessingInfo;
  viewMode: ViewMode;
  history: CloudHistoryEntry[];
  editingNameIdx: number | null;
  setEditingNameIdx: (v: number | null) => void;
  editingNameValue: string;
  setEditingNameValue: (v: string) => void;
  renameEntry: (index: number, name: string) => void;
  setDeleteConfirmIdx: (v: number | null) => void;
  onRestore: (entry: CloudHistoryEntry) => void;
}) {
  return (
    <>
      {cloud ? (
        <section style={panelSectionStyle}>
          <h3 style={sectionTitleStyle}>表示中のデータ</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px" }}>
              <span style={{ color: colors.textMuted }}>点数</span>
              <span style={{ fontFamily: monoFont }}>{cloud.x.length.toLocaleString()} pts</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px" }}>
              <span style={{ color: colors.textMuted }}>閾値</span>
              <span style={{ fontFamily: monoFont }}>{">"} 128</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px" }}>
              <span style={{ color: colors.textMuted }}>表示モード</span>
              <span style={{ fontFamily: monoFont }}>{viewMode === "3D" ? "3D" : "2D"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px" }}>
              <span style={{ color: colors.textMuted }}>カラー軸</span>
              <span style={{ fontFamily: monoFont }}>
                {viewMode === "2D-camera" ? "X (depth)" : "Z (flipped)"}
              </span>
            </div>
          </div>
        </section>
      ) : (
        <div
          style={{
            fontSize: "13px",
            color: colors.textMuted,
            textAlign: "center",
            padding: "28px 0",
          }}
        >
          計測データがありません
        </div>
      )}

      {/* 処理条件（バックエンドの depth_meta.json） */}
      {cloud && processing && <ProcessingSection processing={processing} />}

      {/* 測定履歴 */}
      {history.length > 0 && (
        <section style={{ ...panelSectionStyle, borderBottom: "none" }}>
          <h3 style={sectionTitleStyle}>測定履歴（最新5件）</h3>
          {(
            [
              "coin",
              "coin2",
              "coin_paper",
              "tgv",
              "elec",
              "medical",
              "semi",
              "csv",
              "ai",
            ] as HistorySource[]
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
                  : src === "coin_paper"
                    ? "論文硬貨"
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
                    color: colors.textDim,
                    marginBottom: "6px",
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
                          gap: "8px",
                          padding: "8px 10px",
                          borderRadius: "8px",
                          backgroundColor: isCurrent ? colors.primarySoft : colors.bgLight,
                          border: isCurrent
                            ? `1px solid ${colors.primary}80`
                            : `1px solid ${colors.border}`,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            minWidth: 0,
                          }}
                        >
                          <img
                            src={entry.thumbnail}
                            alt={`#${history.length - i}`}
                            style={{
                              width: "48px",
                              height: "48px",
                              borderRadius: "6px",
                              border: `1px solid ${colors.border}`,
                              flexShrink: 0,
                            }}
                          />
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "2px",
                              minWidth: 0,
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
                            <span
                              style={{
                                fontFamily: monoFont,
                                fontSize: "10.5px",
                                color: colors.textMuted,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {entry.measuredAt}
                            </span>
                            <span
                              style={{
                                fontFamily: monoFont,
                                fontSize: "11px",
                                color: colors.textDim,
                              }}
                            >
                              {entry.points.toLocaleString()} pts
                            </span>
                          </div>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: "6px",
                            alignItems: "center",
                            flexShrink: 0,
                            whiteSpace: "nowrap",
                          }}
                        >
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
                              className="tt-hover"
                              style={{
                                padding: "4px 10px",
                                fontSize: "11px",
                                fontWeight: 600,
                                fontFamily,
                                border: `1px solid ${colors.borderLight}`,
                                borderRadius: "6px",
                                backgroundColor: "transparent",
                                color: colors.text,
                                cursor: "pointer",
                              }}
                              onClick={() => onRestore(entry)}
                            >
                              復元
                            </button>
                          )}
                          <button
                            className="tt-hover"
                            style={{
                              padding: "4px 10px",
                              fontSize: "11px",
                              fontWeight: 600,
                              fontFamily,
                              border: `1px solid ${colors.border}`,
                              borderRadius: "6px",
                              backgroundColor: "transparent",
                              color: colors.textDim,
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
        </section>
      )}
    </>
  );
}

// 処理条件の1行
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "12.5px" }}
    >
      <span style={{ color: colors.textMuted, whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontFamily: monoFont, textAlign: "right", wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

// 処理条件と深さの求め方。同じデータでも結果が変わる条件（CPU/GPU 等）の注意書きもここに出す
function ProcessingSection({ processing }: { processing: NonNullable<ProcessingInfo> }) {
  const m = processing.meta;
  const depth =
    processing.depthSource === "subpixel"
      ? m?.depth_method === "prob_centroid"
        ? "サブピクセル（確率加重重心）"
        : "サブピクセル（3点放物線）"
      : "画素の重心（従来）";
  const rows: [string, string][] = [["深さの求め方", depth]];
  if (m?.source === "preprocess") {
    if (m.algorithm) rows.push(["アルゴリズム", m.algorithm]);
    if (m.use_gpu != null) rows.push(["処理", m.use_gpu ? "GPU" : "CPU"]);
    if (m.blur?.sweep_sigma != null)
      rows.push(["ブラー σ（掃引 / 面内）", `${m.blur.sweep_sigma} / ${m.blur.xy_sigma ?? "—"}`]);
    if (m.peak_threshold != null) rows.push(["ピークしきい値", String(m.peak_threshold)]);
  } else if (m?.source === "ai_inference") {
    if (m.model_type) rows.push(["モデル", m.model_type]);
    if (m.threshold != null) rows.push(["しきい値", String(m.threshold)]);
    if (m.device) rows.push(["デバイス", m.device]);
  }
  if (m?.created_at) rows.push(["処理日時", m.created_at.replace("T", " ").slice(0, 19)]);
  return (
    <section style={panelSectionStyle}>
      <h3 style={sectionTitleStyle}>処理条件</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {rows.map(([k, v]) => (
          <InfoRow key={k} label={k} value={v} />
        ))}
      </div>
      {m?.note && (
        <div
          style={{
            marginTop: "10px",
            padding: "8px 10px",
            borderRadius: "8px",
            backgroundColor: colors.primarySoft,
            color: colors.primary,
            fontSize: "11.5px",
            lineHeight: 1.6,
          }}
        >
          {m.note}
        </div>
      )}
      {!m && (
        <div
          style={{ marginTop: "8px", fontSize: "11.5px", color: colors.textDim, lineHeight: 1.6 }}
        >
          処理条件の記録（depth_meta.json）が無いフォルダです。
        </div>
      )}
    </section>
  );
}
