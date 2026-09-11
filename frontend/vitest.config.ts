import { defineConfig } from "vitest/config";

// utils の純粋関数を対象にしたユニットテスト設定。
// DOM に依存しない関数だけを対象にしているため environment は node のまま。
// window.setInterval 等を使う関数は各テスト内で vi.stubGlobal する。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
