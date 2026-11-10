// 主題名稱登記處。顏色定義在 app/styles/themes.css。
import { t } from '../core/i18n.js';
export const THEMES = ['paper', 'ink', 'slate'];
/** 主題的顯示名稱(依介面語言)。 */
export const themeName = name => t('theme.' + name);

let uiPreferred = null; // 首頁與目錄頁使用中時才有值;播放器套用主題時清掉

export function applyTheme(name) {
  uiPreferred = null;
  document.documentElement.dataset.theme = THEMES.includes(name) ? name : 'paper';
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

/** 首頁與目錄頁:電腦設成深色模式時用 ink,否則用指定的主題。投影片本身的主題不受影響。 */
export function applyUITheme(preferred = 'paper') {
  applyTheme(darkQuery?.matches ? 'ink' : preferred);
  uiPreferred = preferred;
}
darkQuery?.addEventListener?.('change', () => { if (uiPreferred != null) applyUITheme(uiPreferred); });

export function currentTheme() {
  return document.documentElement.dataset.theme || 'paper';
}
