// 筆記的表格檢視(唯讀):把每篇筆記的 front matter 排成一列,可以排序、篩選。
// 純邏輯,瀏覽器與測試共用。只讀不寫,不會改到任何檔案。

import { LAYOUT_KEYS } from './note.js';

// 已經有固定欄位或屬於系統用途的鍵,不再當成自訂欄位
const RESERVED = new Set(['title', 'date', 'tags', 'aliases', 'public', 'private', 'local_only', 'lang', 'source', 'source_hash',
  'pinned', 'expires', 'from_deck', 'cssclasses', ...LAYOUT_KEYS]);

/** front matter 裡可以當成欄位的鍵值(只收文字、數字、是非、與由這些組成的清單)。 */
export function noteFields(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (RESERVED.has(k) || k.startsWith('x-') || v == null || v === '') continue;
    const ok = x => ['string', 'number', 'boolean'].includes(typeof x) || x instanceof Date;
    if (ok(v)) out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
    else if (Array.isArray(v) && v.length && v.every(ok)) out[k] = v.map(x => (x instanceof Date ? x.toISOString().slice(0, 10) : x));
  }
  return out;
}

/** 至少一篇筆記有的自訂欄位,依出現次數(多的在前)、再依名稱排序,最多 max 個。 */
export function tableColumns(rows, max = 6) {
  const count = new Map();
  for (const r of rows) for (const k of Object.keys(r.fields || {})) count.set(k, (count.get(k) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([k]) => k);
}

/** 儲存格顯示的文字。 */
export function cellText(v) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v.map(cellText).join(', ');
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  return String(v);
}

/** 一列在某欄的值:固定欄位直接取,其餘從 fields 取。 */
export const valueOf = (row, key) => (key in row && key !== 'fields' ? row[key] : row.fields?.[key]);

/** 比大小:數字照數字、其餘照文字(日期 YYYY-MM-DD 照文字比就對)。空的一律排最後。 */
const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length);

export function compareCells(a, b) {
  const ea = isEmpty(a), eb = isEmpty(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return cellText(a).localeCompare(cellText(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** 依某欄排序(不改原陣列)。空值不管升冪降冪都排最後;同值依標題。 */
export function sortRows(rows, key, dir = 'asc') {
  const s = dir === 'desc' ? -1 : 1;
  return [...rows].sort((x, y) => {
    const a = valueOf(x, key), b = valueOf(y, key);
    if (isEmpty(a) !== isEmpty(b)) return isEmpty(a) ? 1 : -1;
    return (compareCells(a, b) * s) || compareCells(x.title, y.title);
  });
}

/**
 * 篩選:words 每個字都要出現在這列的某處(標題、路徑、標籤、欄位值);
 * tag 指定時只留有這個標籤的;keep(row) 是額外條件(例如分類)。
 */
export function filterRows(rows, { words = [], tag = '', keep = null } = {}) {
  return rows.filter(r => {
    if (tag && !(r.tags || []).includes(tag)) return false;
    if (keep && !keep(r)) return false;
    if (!words.length) return true;
    const hay = [r.title, r.rel, r.topic, r.book, r.date, ...(r.tags || []), ...Object.values(r.fields || {}).map(cellText)].join(' ').toLowerCase();
    return words.every(w => hay.includes(w));
  });
}
