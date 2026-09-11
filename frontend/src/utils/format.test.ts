import { describe, expect, it } from "vitest";
import { formatElapsed } from "./format";

describe("formatElapsed", () => {
  it("60秒未満は秒のみ・小数1桁", () => {
    expect(formatElapsed(0)).toBe("0.0秒");
    expect(formatElapsed(12345)).toBe("12.3秒");
    expect(formatElapsed(59949)).toBe("59.9秒");
  });

  it("60秒以上は分＋秒", () => {
    expect(formatElapsed(60000)).toBe("1分0.0秒");
    expect(formatElapsed(65000)).toBe("1分5.0秒");
    expect(formatElapsed(3_600_000)).toBe("60分0.0秒");
  });
});
