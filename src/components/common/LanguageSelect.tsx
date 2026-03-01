import type { Language } from "../../types/flight";

interface LanguageSelectProps {
  value: Language;
  onChange: (language: Language) => void;
}

export function LanguageSelect({ value, onChange }: LanguageSelectProps) {
  return (
    <select
      className="control-select"
      value={value}
      onChange={(event) => onChange(event.target.value as Language)}
    >
      <option value="zh-CN">中文</option>
      <option value="en">English</option>
      <option value="ja">日本語</option>
    </select>
  );
}
