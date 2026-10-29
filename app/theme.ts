import { createTheme } from "@mui/material";

// The theme renders every color as a CSS variable of the shown scheme;
// `theme.palette` holds only the light scheme's values.
declare module "@mui/material/styles" {
  interface CssThemeVariables {
    enabled: true;
  }
}

export const theme = createTheme({
  cssVariables: true,
  colorSchemes: {
    light: {
      palette: {
        primary: {
          main: "#2e6559",
        },
      },
    },
    dark: {
      palette: {
        primary: {
          main: "#285A58",
        },
      },
    },
  },
  components: {
    MuiTooltip: {
      styleOverrides: {
        tooltip: ({ theme }) => ({
          backgroundColor: theme.vars.palette.background.paper,
          color: theme.vars.palette.text.primary,
          border: `1px solid ${theme.vars.palette.divider}`,
          boxShadow: theme.shadows[4],
          borderRadius: theme.shape.borderRadius,
          fontSize: "0.8125rem",
          fontWeight: theme.typography.fontWeightRegular,
          padding: theme.spacing(1, 1.5),
        }),
        arrow: ({ theme }) => ({
          color: theme.vars.palette.background.paper,
        }),
      },
    },
  },
});
