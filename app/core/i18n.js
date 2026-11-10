// 介面語言(瀏覽器與 Node 共用)。字串表在 locales/,新增文字時兩份都要加。
//
// 兩種語言分開決定:
//   介面語言:使用者選擇 → 瀏覽器語言(zh 開頭 = 繁中,其他 = 英文)→ 繁中
//   簡報語言:deck.yml 的 lang → 標題等文字含中日韓字元 = 繁中,否則英文
// 簡報語言只影響「自動產生的投影片文字」(謝謝、大綱…)與英文字型,不受介面語言影響。

import { LOCALE_ZH_HANT } from './locales/zh-Hant.js';
import { LOCALE_EN } from './locales/en.js';

export const LANGS = ['zh-Hant', 'en'];
const TABLES = { 'zh-Hant': LOCALE_ZH_HANT, en: LOCALE_EN };
let current = 'zh-Hant';

/** 把各種寫法(zh-TW、zh_hant、en-US…)整理成支援的語言代碼;不支援時回傳 null。 */
export function normalizeLang(value) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  if (v.startsWith('zh')) return 'zh-Hant';
  if (v.startsWith('en')) return 'en';
  return null;
}

export function setLang(lang) { current = normalizeLang(lang) || 'zh-Hant'; return current; }
export function getLang() { return current; }

/** 取字串。lang 省略時用目前介面語言;找不到時退回繁中,再退回鍵名本身。 */
export function t(key, params, lang) {
  const table = TABLES[normalizeLang(lang) || current];
  let s = table[key] ?? TABLES['zh-Hant'][key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

/** 簡報語言:明確設定優先;否則看標題、副標、資料夾與章節名稱是否含中日韓字元。 */
export function detectDeckLang(explicit, ...texts) {
  return normalizeLang(explicit) || (texts.some(s => CJK.test(String(s ?? ''))) ? 'zh-Hant' : 'en');
}
