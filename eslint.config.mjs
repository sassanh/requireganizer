import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import etc from "eslint-plugin-etc";
import importPlugin from "eslint-plugin-import";

/** @type {import("eslint").Linter.Config} */
const config = [
  {
    ignores: [
      "**/.wrangler/**",
      "**/.open-next/**",
      "**/.vercel/**",
      "**/.next/**",
      "**/.test-dist/**",
      "**/docs/.vitepress/cache/**",
      "**/docs/.vitepress/dist/**",
    ],
  },
  ...nextCoreWebVitals,
  {
    plugins: {
      etc,
      import: importPlugin,
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
