import js from "@eslint/js"; // eslint-disable-line n/no-extraneous-import
import { defineConfig } from "eslint/config";

import nodePlugin from "eslint-plugin-n";
import jestPlugin from "eslint-plugin-jest";

export default defineConfig([
  {
    ignores: ["coverage/**", "dist/**", "tmp/**"],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    extends: [
      js.configs.recommended,
      nodePlugin.configs["flat/recommended-module"],
      jestPlugin.configs["flat/style"],
    ],
  },
]);
