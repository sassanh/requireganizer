import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Requireganizer",
  description:
    "Architecture, AI harness, workflow, and contributor documentation for Requireganizer.",
  base: "/requireganizer/",
  cleanUrls: true,
  lastUpdated: true,
  head: [["meta", { name: "theme-color", content: "#5c6ac4" }]],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Architecture", link: "/architecture/overview" },
      { text: "Development", link: "/development/testing" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Using the workflow", link: "/guide/using-the-workflow" },
        ],
      },
      {
        text: "Architecture",
        items: [
          { text: "System overview", link: "/architecture/overview" },
          { text: "Engineering workflow", link: "/architecture/workflow" },
          { text: "AI harness", link: "/architecture/ai-harness" },
          { text: "Prompt contracts", link: "/architecture/prompt-contracts" },
          {
            text: "State and invalidation",
            link: "/architecture/state-and-invalidation",
          },
        ],
      },
      {
        text: "Development",
        items: [
          { text: "Testing and quality", link: "/development/testing" },
          { text: "GitHub Pages", link: "/development/deployment" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Artifact contracts", link: "/reference/artifacts" },
          { text: "Environment variables", link: "/reference/environment" },
        ],
      },
    ],
    search: { provider: "local" },
    outline: { level: [2, 3] },
    editLink: {
      pattern:
        "https://github.com/sassanh/requireganizer/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/sassanh/requireganizer" },
    ],
    footer: {
      message: "Released under the MIT License.",
      copyright: "Requireganizer contributors",
    },
  },
});
