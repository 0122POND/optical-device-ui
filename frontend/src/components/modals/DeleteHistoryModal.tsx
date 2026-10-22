import { colors } from "../../utils/constants";
import { modalButtonStyle, modalCardStyle, modalOverlayStyle } from "../../utils/styles";

// 測定履歴の削除確認（1件／すべて）
export function DeleteHistoryModal({
  clearHistory,
  deleteConfirmIdx,
  removeEntry,
  setDeleteConfirmIdx,
}: {
  clearHistory: () => void;
  deleteConfirmIdx: number | null;
  removeEntry: (index: number) => void;
  setDeleteConfirmIdx: React.Dispatch<React.SetStateAction<number | null>>;
}) {
  return (
    <>
      {deleteConfirmIdx !== null && (
        <div
          style={{ ...modalOverlayStyle, zIndex: 10000 }}
          onClick={() => setDeleteConfirmIdx(null)}
        >
          <div
            style={{ ...modalCardStyle, minWidth: "300px", textAlign: "center" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ margin: "0 0 16px", fontSize: "14px", color: colors.text }}>
              {deleteConfirmIdx === -1
                ? "測定履歴をすべて削除しますか？（ブラウザに保存した分も消えます）"
                : "この測定履歴を削除しますか？"}
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
              <button
                className="tt-hover"
                style={modalButtonStyle("neutral")}
                onClick={() => setDeleteConfirmIdx(null)}
              >
                キャンセル
              </button>
              <button
                className="tt-hover-strong"
                style={modalButtonStyle("danger")}
                onClick={() => {
                  if (deleteConfirmIdx === -1) clearHistory();
                  else if (deleteConfirmIdx !== null) removeEntry(deleteConfirmIdx);
                  setDeleteConfirmIdx(null);
                }}
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
