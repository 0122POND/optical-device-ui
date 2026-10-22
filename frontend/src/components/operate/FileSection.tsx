import { type PointCloud } from "../../utils/pointCloud";
import { colors } from "../../utils/constants";
import { Icon } from "../Icon";
import {
  buttonFileStyle,
  enabledStateStyle,
  panelSectionStyle,
  sectionTitleStyle,
} from "../../utils/styles";
import type { MeasureStatus, DataOrigin } from "../../types";

// 操作タブ「ファイル」（CSV読込・マスク読込・CSV出力）
export function FileSection({
  canExport,
  csvInputRef,
  dataOrigin,
  exportCsv,
  exportPoints,
  handleImportCSV,
  handleLoadMask,
  isLoadingMask,
  status,
}: {
  canExport: boolean;
  csvInputRef: React.RefObject<HTMLInputElement | null>;
  dataOrigin: DataOrigin;
  exportCsv: () => Promise<void>;
  exportPoints: () => PointCloud | null;
  handleImportCSV: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleLoadMask: () => Promise<void>;
  isLoadingMask: boolean;
  status: MeasureStatus;
}) {
  return (
    <>
      <section style={panelSectionStyle}>
        <h3 style={sectionTitleStyle}>ファイル</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "6px",
          }}
        >
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleImportCSV}
          />
          <button
            className="tt-hover"
            style={buttonFileStyle}
            onClick={() => csvInputRef.current?.click()}
          >
            <Icon size={15} color={colors.textMuted}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </Icon>
            CSV読込
          </button>
          <button
            className="tt-hover"
            disabled={status === "RUNNING" || isLoadingMask}
            style={{
              ...buttonFileStyle,
              ...enabledStateStyle(!(status === "RUNNING" || isLoadingMask)),
            }}
            onClick={handleLoadMask}
          >
            <Icon size={15} color={colors.textMuted}>
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </Icon>
            {isLoadingMask ? "読込中..." : "マスク"}
          </button>
          <button
            className="tt-hover"
            disabled={!canExport}
            title={
              !canExport
                ? "書き出せるデータがありません"
                : exportPoints()
                  ? dataOrigin?.kind === "csvPoints"
                    ? "点群形式（x,y,z・高さ µm）で書き出す（ピッチはファイル名に記録）"
                    : "同じ位置に縞が複数ある（複数層の）データのため、層ごとの点を点群形式（x,y,z・高さ µm）で書き出す（ピッチはファイル名に記録）"
                  : "表示中の高さマップを µm で書き出す（ピッチはファイル名に記録）"
            }
            style={{
              ...buttonFileStyle,
              ...enabledStateStyle(canExport),
            }}
            onClick={exportCsv}
          >
            <Icon size={15} color={colors.textMuted}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </Icon>
            CSV出力
          </button>
        </div>
      </section>
    </>
  );
}
