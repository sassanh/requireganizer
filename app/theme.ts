import { createTheme } from "@mui/material";

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
});
