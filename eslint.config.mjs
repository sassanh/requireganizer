/// <reference path="./eslint-types.d.ts" />
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import etc from "eslint-plugin-etc";

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
    ignores: ["**/.wrangler/**", "**/.open-next/**"],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    plugins: {
      etc,
    },

    rules: {
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
