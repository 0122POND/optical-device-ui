// src/utils/csv.ts

export function downloadCSV(
    zData: (number | null)[][],
    filename = "surface.csv"
  ) {
    const rows = zData.map((row) =>
      row.map((v) => (v == null ? "" : v.toString())).join(",")
    );
    const csv = rows.join("\n");
  
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
  