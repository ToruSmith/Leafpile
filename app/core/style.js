// 每張投影片的外觀設定(size、background、overlay、text、font、align、ratio)。
// 這些值會放進 class 或 style 屬性,所以一律在這裡驗證成固定格式,不合法就忽略並回報。
// 瀏覽器與 Node(檢查工具)共用,不能用到 DOM。

import { safeColor } from './color.js';

export const SIZES = { small: 0.8, compact: 0.8, normal: 1, large: 1.15, xl: 1.3 };
export const OVERLAYS = ['auto', 'dark', 'light', 'none'];
export const ALIGNS = ['left', 'center', 'right'];

/** 字型名稱白名單:只允許文字、數字、空白、連字號、底線、點(不能放引號、括號、url())。 */
const FONT_NAME = /^[\p{L}\p{N} ._-]{1,60}$/u;

/** 「Noto Sans TC, Arial」→ `"Noto Sans TC", "Arial"`;不合法回傳 null。 */
export function safeFonts(value) {
  const names = String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length || names.some(n => !FONT_NAME.test(n))) return null;
  return names.map(n => `"${n}"`).join(', ');
}

/** 「2:1」「1:1:2」→ `2fr 1fr`;每個數字 0.5–6,最多 4 欄。不合法回傳 null。 */
export function parseRatio(value) {
  const parts = String(value ?? '').split(/\s*[:/]\s*/);
  if (parts.length < 2 || parts.length > 4) return null;
  const nums = parts.map(Number);
  if (nums.some(n => !Number.isFinite(n) || n < 0.5 || n > 6)) return null;
  return nums.map(n => `${n}fr`).join(' ');
}

/** 顏色的相對亮度(0 暗 – 1 亮)。只認得 #色碼 與 rgb();其他格式回傳 null(不自動換字色)。 */
export function luminance(color) {
  const v = String(color || '').trim();
  let rgb = null;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
    rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) rgb = [m[1], m[2], m[3]].map(Number);
  }
  if (!rgb) {
    const NAMED = { black: 0, white: 1, navy: 0.016, darkblue: 0.018, maroon: 0.046, darkgreen: 0.09, purple: 0.061, indigo: 0.031, darkslategray: 0.06, midnightblue: 0.02 };
    return NAMED[v.toLowerCase()] ?? null;
  }
  const [r, g, b] = rgb.map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 整理一張投影片的外觀設定。meta 會被就地整理(不合法的值刪掉),問題推進 issues。
 * 回傳給 render.js 用的結果:{ size, bgColor, bgImage, overlay, text, font, align, ratio }。
 */
export function readSlideStyle(meta, { path, issues = [], t = k => k } = {}) {
  const out = {};
  const bad = (key, value) => { issues.push({ path, message: t('issue.slideStyle', { key, value }) }); delete meta[key]; };

  if (meta.size != null) {
    const s = String(meta.size).toLowerCase();
    if (s in SIZES) out.size = s === 'compact' ? 'small' : s; else bad('size', meta.size);
  }
  if (meta.background != null && meta.background !== '') {
    const c = safeColor(meta.background);
    const v = String(meta.background).trim();
    if (c && (/^(#|rgb|hsl)/i.test(v) || !/[./]/.test(v))) out.bgColor = c; else out.bgImage = v; // 有 . 或 / 的是檔案路徑
  }
  if (meta.overlay != null) {
    const o = String(meta.overlay).toLowerCase();
    if (OVERLAYS.includes(o)) out.overlay = o; else bad('overlay', meta.overlay);
  }
  if (meta.text != null) {
    const c = safeColor(meta.text);
    if (c) out.text = c; else bad('text', meta.text);
  }
  if (meta.font != null) {
    const f = safeFonts(meta.font);
    if (f) out.font = f; else bad('font', meta.font);
  }
  if (meta.align != null) {
    const a = String(meta.align).toLowerCase();
    if (ALIGNS.includes(a)) out.align = a; else bad('align', meta.align);
  }
  if (meta.ratio != null) {
    const r = parseRatio(meta.ratio);
    if (r) out.ratio = r; else bad('ratio', meta.ratio);
  }
  // 背景是深色或淺色:決定字要不要反白(背景色看亮度;背景圖看遮罩)
  if (out.bgColor) { const l = luminance(out.bgColor); if (l != null) out.tone = l < 0.35 ? 'dark' : 'light'; }
  if (out.bgImage && (out.overlay === 'dark' || out.overlay === 'light')) out.tone = out.overlay;
  return out;
}
