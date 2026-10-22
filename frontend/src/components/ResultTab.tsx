import { useMemo } from "react";
import { colors, fontFamily, monoFont } from "../utils/constants";
import { panelSectionStyle, sectionTitleStyle } from "../utils/styles";
import type { CloudHistoryEntry, HistorySource, ProcessingInfo } from "../types";
import type { PointCloud } from "../utils/pointCloud";
import type { PostResult } from "../utils/postprocess";
import { gridScale, physicalGrid, type DataSource, type ScaleInputs } from "../utils/units";
import {
  heightStats,
  ROUGHNESS_NOISE_FLOOR_UM,
  ROUGHNESS_WARN_SA_UM,
  validRates,
} from "../utils/surfaceStats";

// サイドパネル「測定結果」タブ：現在の点群情報と測定履歴（リネーム/復元/削除）
export function ResultTab({
  cloud,
  zData,
  postResult,
  dataSource,
  scale,
  flipX,
  flipRef,
  processing,
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
  // 統計を出す高さマップと、その換算条件（表示と同じ µm 換算・反転で数える）
  zData: (number | null)[][] | null;
  // 後処理（外れ値除去・補間）の結果。掛けていなければ null
  postResult: PostResult | null;
  dataSource: DataSource;
  scale: ScaleInputs;
  flipX: boolean;
  flipRef: number;
  // 表示中データの処理条件と深さの求め方（計測・推論・マスク読込のとき。CSV では null）
  processing: ProcessingInfo;
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
            {zData && zData.length > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px" }}>
                <span style={{ color: colors.textMuted }}>高さマップ</span>
                <span style={{ fontFamily: monoFont }}>
                  {zData.length} × {zData[0].length}
                </span>
              </div>
            )}
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

      {/* 統計（有効率・高さ・平面除去後の凹凸） */}
      {cloud && zData && zData.length > 0 && (
        <StatsSection
          zData={zData}
          postResult={postResult}
          dataSource={dataSource}
          scale={scale}
          flipX={flipX}
          flipRef={flipRef}
        />
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
                            : src === "ai"
                              ? "AI推論"
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
    processing.depthSource === "prob"
      ? `確率マップから再抽出（しきい値 ${processing.threshold?.toFixed(2) ?? "—"}・確率加重重心）`
      : processing.depthSource === "subpixel"
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

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// 表示中の高さマップの統計。有効率は領域ごと（取り方で値が大きく違うため、領域名を必ず添える）
function StatsSection({
  zData,
  postResult,
  dataSource,
  scale,
  flipX,
  flipRef,
}: {
  zData: (number | null)[][];
  postResult: PostResult | null;
  dataSource: DataSource;
  scale: ScaleInputs;
  flipX: boolean;
  flipRef: number;
}) {
  const nFilled = postResult ? postResult.filledLinear + postResult.filledSpline : 0;
  const stats = useMemo(() => {
    const pg = physicalGrid(zData, dataSource, scale, flipX, flipRef);
    return { rates: validRates(zData), h: heightStats(pg.z, pg.x, pg.y) };
  }, [zData, dataSource, scale, flipX, flipRef]);
  const unit = gridScale(dataSource, scale).valueUnit;
  const f = (v: number) => `${v.toFixed(unit === "µm" ? 2 : 3)} ${unit}`;
  const { rates, h } = stats;
  // 粗さとして読めない大きさの注意は、デバイスの干渉縞データ（深さ分解能 1.8µm/px）のときだけ
  const nearFloor = dataSource === "device" && h != null && h.sa < ROUGHNESS_WARN_SA_UM;
  return (
    <section style={panelSectionStyle}>
      <h3 style={sectionTitleStyle}>統計</h3>
      {postResult && (
        <div
          style={{
            marginBottom: "10px",
            padding: "8px 10px",
            borderRadius: "8px",
            backgroundColor: colors.primarySoft,
            color: colors.primary,
            fontSize: "11.5px",
            lineHeight: 1.6,
          }}
        >
          後処理後の値です
          {nFilled > 0 && `（補間 ${nFilled.toLocaleString()} 画素を含む）`}
          。精度評価には後処理前のデータを使ってください。
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <InfoRow label="有効率（全体）" value={pct(rates.full)} />
        <InfoRow label="有効率（中央50%×50%）" value={pct(rates.center50)} />
        <InfoRow label="有効率（中央面積50%）" value={pct(rates.centerArea50)} />
        {h && (
          <>
            <InfoRow label="平均 ± 標準偏差" value={`${f(h.mean)} ± ${h.std.toFixed(2)}`} />
            <InfoRow label="最小 〜 最大" value={`${h.min.toFixed(2)} 〜 ${f(h.max)}`} />
            <InfoRow label="P1 〜 P99" value={`${h.p1.toFixed(2)} 〜 ${f(h.p99)}`} />
            <InfoRow label="平面除去後 Sq / Sa" value={`${h.sq.toFixed(2)} / ${f(h.sa)}`} />
          </>
        )}
      </div>
      <div style={{ marginTop: "8px", fontSize: "11px", color: colors.textDim, lineHeight: 1.6 }}>
        中央50%×50% は縦横それぞれ中央の半分、中央面積50% は面積で半分（各辺 約70.7%）。 Sq / Sa
        は最小二乗平面を引いた残りの二乗平均平方根 / 平均絶対値。
      </div>
      {nearFloor && (
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
          Sa が {ROUGHNESS_WARN_SA_UM} µm 未満です。縞位置の抽出ノイズ（約{ROUGHNESS_NOISE_FLOOR_UM}{" "}
          µm）に近く、 粗さの値としては読めません（面形状・うねりの確認向け）。
        </div>
      )}
    </section>
  );
}
