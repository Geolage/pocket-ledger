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

export function faviconHref(primary: string, accent: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>` +
    `<rect width='32' height='32' rx='8' fill='${primary}'/>` +
    `<path d='M9 8.5C9 7.12 10.12 6 11.5 6H23a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H11.5C10.12 26 9 24.88 9 23.5z' fill='#fff'/>` +
    `<path d='M9 8.5C9 7.12 10.12 6 11.5 6v20C10.12 26 9 24.88 9 23.5z' fill='${accent}'/>` +
    `<path d='M14 11h6M14 15h6M14 19h4' stroke='${primary}' stroke-width='2.2' stroke-linecap='round'/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;

  const styles = getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--background").trim();
  const primary = styles.getPropertyValue("--primary").trim();
  const accent = styles.getPropertyValue("--cat-2").trim();

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && background) meta.setAttribute("content", background);

  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon && primary && accent) favicon.href = faviconHref(primary, accent);
}
