"use client";

import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#006d77",
    },
    secondary: {
      main: "#d1495b",
    },
    background: {
      default: "#d8e8ea",
      paper: "rgba(255, 250, 244, 0.88)",
    },
  },
  shape: {
    borderRadius: 20,
  },
  typography: {
    fontFamily: "var(--font-body), sans-serif",
    h1: {
      fontFamily: "var(--font-heading), sans-serif",
      fontWeight: 700,
      letterSpacing: "-0.04em",
    },
    h2: {
      fontFamily: "var(--font-heading), sans-serif",
      fontWeight: 700,
      letterSpacing: "-0.04em",
    },
    h3: {
      fontFamily: "var(--font-heading), sans-serif",
      fontWeight: 700,
      letterSpacing: "-0.03em",
    },
    button: {
      textTransform: "none",
      fontWeight: 600,
    },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backdropFilter: "blur(18px)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          paddingInline: 20,
        },
      },
    },
  },
});

export default function MuiThemeProvider({ children }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}