// src/utils/csv.ts

declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
  }
}

export async function downloadCSV(zData: (number | null)[][], filename = "surface.csv") {
  const rows = zData.map((row) => row.map((v) => (v == null ? "" : v.toString())).join(","));
  const csv = rows.join("\n");

  // File System Access API 対応ブラウザの場合
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker!({
        suggestedName: filename,
        types: [
          {
            description: "CSV Files",
            accept: { "text/csv": [".csv"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(csv);
      await writable.close();
      return;
    } catch (e) {
      // ユーザーがキャンセルした場合は何もしない
      if (e instanceof DOMException && e.name === "AbortError") return;
      // その他のエラーはフォールバック
    }
  }

  // フォールバック: 従来のBlobダウンロード
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
