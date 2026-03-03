import { alpha, createTheme } from "@mui/material/styles";
import type { ThemeMode } from "../types/flight";

export function createAppTheme(mode: ThemeMode) {
  const dark = mode === "dark";

  return createTheme({
    palette: {
      mode,
      primary: {
        main: dark ? "#56c2ff" : "#1976d2"
      },
      secondary: {
        main: dark ? "#9cc8ff" : "#5d84ff"
      },
      background: {
        default: dark ? "#081321" : "#eff4fa",
        paper: dark ? "#132236" : "#ffffff"
      }
    },
    shape: {
      borderRadius: 6
    },
    typography: {
      fontFamily: '"IBM Plex Sans", "Noto Sans SC", "Segoe UI", sans-serif',
      h6: {
        fontWeight: 700,
        letterSpacing: 0.15
      }
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          "html, body, #root": {
            width: "100%",
            height: "100%",
            margin: 0
          },
          body: {
            background: dark
              ? "radial-gradient(1100px 560px at 50% -20%, rgba(44, 108, 158, 0.46), transparent), linear-gradient(180deg, #091728, #050c16)"
              : "radial-gradient(1100px 560px at 50% -20%, rgba(74, 158, 230, 0.25), transparent), linear-gradient(180deg, #f5f9ff, #eaf1f9)",
            color: dark ? "#e6f2ff" : "#10253a"
          },
          "*, *::before, *::after": {
            boxSizing: "border-box"
          }
        }
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none"
          }
        }
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 600,
            minHeight: 30
          }
        }
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 600
          }
        }
      },
      MuiSlider: {
        styleOverrides: {
          rail: {
            opacity: 0.26
          },
          thumb: {
            boxShadow: "none"
          }
        }
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            backgroundColor: dark ? alpha("#203751", 0.7) : alpha("#edf4ff", 0.9),
            fontWeight: 700
          }
        }
      }
    }
  });
}
