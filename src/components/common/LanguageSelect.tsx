import TranslateRoundedIcon from "@mui/icons-material/TranslateRounded";
import { Box, MenuItem, Select } from "@mui/material";
import type { Language } from "../../types/flight";

interface LanguageSelectProps {
  value: Language;
  onChange: (language: Language) => void;
  compact?: boolean;
  ariaLabel?: string;
}

const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: "zh-CN", label: "中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" }
];

function labelByLanguage(language: Language): string {
  return LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? "中文";
}

export function LanguageSelect({ value, onChange, compact = false, ariaLabel }: LanguageSelectProps) {
  return (
    <Select
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value as Language)}
      inputProps={ariaLabel ? { "aria-label": ariaLabel } : undefined}
      renderValue={(selected) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
          <TranslateRoundedIcon sx={{ fontSize: 16, opacity: 0.78 }} />
          <Box component="span" sx={{ fontWeight: 600, letterSpacing: 0.1 }}>
            {labelByLanguage(selected as Language)}
          </Box>
        </Box>
      )}
      sx={{
        minWidth: compact ? 120 : 112,
        borderRadius: 1.25,
        "& .MuiSelect-select": {
          py: compact ? 0.72 : 0.8,
          pl: compact ? 1 : 1.2,
          pr: "30px !important"
        },
        ...(compact
          ? {
              bgcolor: "action.hover",
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: "divider"
              },
              "&:hover .MuiOutlinedInput-notchedOutline": {
                borderColor: "primary.main"
              }
            }
          : {})
      }}
      MenuProps={{
        PaperProps: {
          sx: {
            mt: 0.6,
            borderRadius: 1.2,
            border: "1px solid",
            borderColor: "divider",
            overflow: "hidden",
            "& .MuiMenuItem-root": {
              minHeight: 38,
              fontWeight: 550
            }
          }
        }
      }}
    >
      {LANGUAGE_OPTIONS.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </Select>
  );
}
