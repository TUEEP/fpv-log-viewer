import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./zh-CN.json";
import en from "./en.json";
import ja from "./ja.json";

const resources = {
  "zh-CN": {
    translation: zhCN
  },
  en: {
    translation: en
  },
  ja: {
    translation: ja
  }
};

function detectLanguage(): "zh-CN" | "en" | "ja" {
  if (typeof navigator === "undefined") {
    return "zh-CN";
  }

  const lang = (navigator.language || "zh-CN").toLowerCase();
  if (lang.startsWith("zh")) {
    return "zh-CN";
  }
  if (lang.startsWith("ja")) {
    return "ja";
  }
  return "en";
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: "zh-CN",
  interpolation: {
    escapeValue: false
  }
});

export default i18n;
