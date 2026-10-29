import type { ReactNode } from "react";

/**
 * A React root that renders inside the app's theme, as the page does:
 * components read colors from the theme's CSS variables. Load it after
 * the DOM globals, like react-dom.
 */
export async function createThemedRoot(container: Element) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ThemeProvider } = await import("@mui/material/styles");
  const { theme } = await import("../../app/theme");
  const root = createRoot(container);
  return {
    render: (node: ReactNode) => root.render(React.createElement(ThemeProvider, { theme }, node)),
    unmount: () => root.unmount(),
  };
}
