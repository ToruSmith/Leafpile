// 主題名稱登記處。顏色定義在 app/styles/themes.css。
// 筆記、書庫、畫布與簡報共用同一份清單:簡報用 deck.yml 的 theme(或播放時按 T 切換),
// 其他畫面用「外觀」選單的選擇;沒選過時用書庫 _site.yml 的 theme,電腦是深色模式時用 ink。
import { t } from '../core/i18n.js';
export const THEMES = ['paper', 'ink', 'slate', 'sepia', 'nord'];
/** 深色主題(電腦設成深色模式時,「自動」會用 ink)。 */
export const DARK = new Set(['ink', 'nord']);
/** 主題的顯示名稱(依介面語言)。 */
export const themeName = name => t('theme.' + name);

let uiPreferred = null; // 首頁與目錄頁使用中時才有值;播放器套用主題時清掉
let uiChoice = ''; // 使用者在「外觀」選單選的主題;'' = 自動

export function applyTheme(name) {
  uiPreferred = null;
  document.documentElement.dataset.theme = THEMES.includes(name) ? name : 'paper';
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

/** 介面(非投影片)該用哪個主題:使用者的選擇 → 深色模式用 ink → 書庫指定的主題。 */
export function uiThemeFor(preferred = 'paper', { choice = uiChoice, dark = !!darkQuery?.matches } = {}) {
  if (THEMES.includes(choice)) return choice;
  if (dark) return 'ink';
  return THEMES.includes(preferred) ? preferred : 'paper';
}

/** 首頁、書庫、筆記、畫布:套用介面主題。投影片本身的主題不受影響。 */
export function applyUITheme(preferred = 'paper') {
  applyTheme(uiThemeFor(preferred));
  uiPreferred = preferred;
}
darkQuery?.addEventListener?.('change', () => { if (uiPreferred != null) applyUITheme(uiPreferred); });

/** 設定「外觀」選單的選擇('' = 自動),並立刻套用到目前的介面畫面。 */
export function setUIChoice(name) {
  uiChoice = THEMES.includes(name) ? name : '';
  if (uiPreferred != null) applyUITheme(uiPreferred);
}
export const uiChoiceNow = () => uiChoice;

export function currentTheme() {
  return document.documentElement.dataset.theme || 'paper';
}
