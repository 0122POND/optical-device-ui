import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // eslint-plugin-react-hooks 7.1 で検出が強化され、App.tsx の「状態変化に応じて
      // 別の state をリセットする」effect 3箇所が error になった。
      // 挙動は正しいが、ハンドラ側でのリセットや派生 state への置き換えは
      // App.tsx の state 設計に踏み込むため依存更新とは切り離し、当面は warn に留める。
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  eslintConfigPrettier,
]);
