/* 主题注册表：新增一套主题 = 在 globals.css 加一个 data-theme 区块，再在这里登记一条。 */

export type ThemeId = "celadon" | "mist" | "sage";

export interface ThemeOption {
  id: ThemeId;
  name: string;
  tagline: string;
  /** 设置页色卡预览用 */
  swatches: string[];
}

export const THEMES: ThemeOption[] = [
  {
    id: "celadon",
    name: "L1 淡青瓷",
    tagline: "中性偏暖，最贴近「温暖轻松」",
    swatches: ["#4E8F82", "#A9D3C8", "#E8DCC8"],
  },
  {
    id: "mist",
    name: "L2 淡雾蓝",
    tagline: "偏冷克制，报表视角",
    swatches: ["#55839B", "#A6C6D8", "#E7DCCB"],
  },
  {
    id: "sage",
    name: "L3 淡影灰绿",
    tagline: "冷暖不偏，最中性",
    swatches: ["#5E8E80", "#B4D0C4", "#EADFC9"],
  },
];

export const DEFAULT_THEME: ThemeId = "celadon";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((theme) => theme.id === value);
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && background) meta.setAttribute("content", background);
}
