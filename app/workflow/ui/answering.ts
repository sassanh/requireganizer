import { keyframes, type Theme } from "@mui/material/styles";

const turn = keyframes`
  from { transform: translate(-50%, -50%) rotate(0turn); }
  to { transform: translate(-50%, -50%) rotate(1turn); }
`;

/** A border that runs around an element while the coding agent is answering its thread. */
export const answeringSx = (theme: Theme) => ({
  position: "relative",
  overflow: "hidden",
  isolation: "isolate",
  "&::before": {
    content: '""',
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "200%",
    aspectRatio: "1",
    zIndex: -2,
    background: `conic-gradient(${theme.vars.palette.primary.main} 0turn 0.25turn, ${theme.vars.palette.divider} 0.25turn)`,
    animation: `${turn} 1.5s linear infinite`,
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  },
  "&::after": {
    content: '""',
    position: "absolute",
    inset: "1px",
    borderRadius: "inherit",
    zIndex: -1,
    background: theme.vars.palette.background.paper,
  },
});
