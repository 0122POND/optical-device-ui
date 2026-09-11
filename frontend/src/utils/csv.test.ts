import { describe, expect, it } from "vitest";
import { parseCSV } from "./csv";

describe("parseCSV", () => {
  it("数値をそのまま2Dグリッドにする", () => {
    expect(parseCSV("1,2,3\n4,5,6")).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("Keyence の欠損値 -9999.9 は null になる", () => {
    expect(parseCSV("-9999.9,1.5\n2.5,-9999.9")).toEqual([
      [null, 1.5],
      [2.5, null],
    ]);
  });

  it("空セル・数値でないセルは null になる", () => {
    expect(parseCSV("1,,3\nabc,2, ")).toEqual([
      [1, null, 3],
      [null, 2, null],
    ]);
  });

  it("Keyence 実データ形式（CRLF・符号付き）を読める", () => {
    // data/surface_keyence/*.csv は CRLF 改行・正数に "+" が付く形式
    const text = "-9999.9,+430.1,+430.0\r\n+429.9,-9999.9,-12.5\r\n";
    expect(parseCSV(text)).toEqual([
      [null, 430.1, 430.0],
      [429.9, null, -12.5],
    ]);
  });

  it("末尾の改行やセル周りの空白は無視する", () => {
    expect(parseCSV(" 1 , 2 \n 3 , 4 \n\n")).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("-9999.9 に近いが異なる値は欠損扱いしない", () => {
    expect(parseCSV("-9999.8,-9999.90,-10000")).toEqual([[-9999.8, -9999.9, -10000]]);
  });

  it("空文字・空白のみのテキストは空配列", () => {
    expect(parseCSV("")).toEqual([]);
    expect(parseCSV("  \r\n\n ")).toEqual([]);
  });

  it("全欠損行も行として保持する（落とすと走査方向の寸法が狂う）", () => {
    expect(parseCSV("1,2\n-9999.9,-9999.9\n3,4")).toEqual([
      [1, 2],
      [null, null],
      [3, 4],
    ]);
  });
});
