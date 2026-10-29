import "@mui/material/styles";

// The theme renders every color as a CSS variable of the shown scheme;
// `theme.palette` holds only the light scheme's values.
declare module "@mui/material/styles" {
  interface CssThemeVariables {
    enabled: true;
  }
}
