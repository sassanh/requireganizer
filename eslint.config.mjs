/// <reference path="./eslint-types.d.ts" />
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import etc from "eslint-plugin-etc";
import _import from "eslint-plugin-import";
import nextOnPages from "eslint-plugin-next-on-pages";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

/** @type {import("eslint").Linter.Config} */
const config = [
  {
    ignores: ["**/.wrangler/**"],
  },
  ...compat.extends(
    "next/core-web-vitals",
    "plugin:eslint-plugin-next-on-pages/recommended",
  ),
  {
    plugins: {
      "next-on-pages": nextOnPages,
      etc,
    },

    rules: {
      // "etc/no-commented-out-code": "error",

      "no-console": [
        "error",
        {
          allow: ["debug", "warn", "error"],
        },
      ],

      "import/no-duplicates": "error",

      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
          ],
          "newlines-between": "always",

          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
        },
      ],
    },
  },
];

export default config;
