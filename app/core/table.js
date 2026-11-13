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

// ---------- 分組 ----------
// 依某個欄位把列分成幾組(每組可以在畫面上折疊)。組內保留傳進來的順序(先排序再分組)。
// 標籤或清單欄位:一列可以同時出現在好幾組。沒有值的列放在最後一組(id 為 '')。

/** 內建的分組依據;另外任何自訂欄位名稱都可以。 */
export const GROUP_KEYS = ['category', 'topic', 'book', 'year', 'month', 'tags'];

/** 一列在某個分組依據下屬於哪些組(id 清單)。 */
export function groupIdsOf(row, key) {
  if (key === 'category') return [row.category || ''];
  if (key === 'topic') return [row.topicId || ''];
  if (key === 'year') return [/^\d{4}/.test(row.date || '') ? row.date.slice(0, 4) : ''];
  if (key === 'month') return [/^\d{4}-\d{2}/.test(row.date || '') ? row.date.slice(0, 7) : ''];
  const v = key === 'tags' ? row.tags : key === 'book' ? row.book : row.fields?.[key];
  if (Array.isArray(v)) return v.length ? [...new Set(v.map(cellText))] : [''];
  return [isEmpty(v) ? '' : cellText(v)];
}

/**
 * 分組。
 * @param {object[]} rows 已經排序、篩選過的列
 * @param {string} key 分組依據('' = 不分組)
 * @param {{ order?: string[], labels?: Map<string,string>|object }} [opts]
 *   order:這些 id 依給定順序排在前面(分類、主題用書庫的順序);其餘:年、月由新到舊,其他依名稱
 *   labels:id → 顯示名稱(分類 id → 分類名稱)
 * @returns {{ id: string, label: string, rows: object[] }[]}
 */
export function groupRows(rows, key, { order = [], labels = {} } = {}) {
  if (!key) return [{ id: '*', label: '', rows: [...rows] }];
  const lab = id => (labels instanceof Map ? labels.get(id) : labels[id]) || id;
  const groups = new Map();
  for (const r of rows) {
    for (const id of groupIdsOf(r, key)) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(r);
    }
  }
  const pos = new Map(order.map((id, i) => [id, i]));
  const desc = key === 'year' || key === 'month';
  const ids = [...groups.keys()].sort((a, b) => {
    if (!a || !b) return a === b ? 0 : a ? -1 : 1; // 沒有值的放最後
    const pa = pos.get(a), pb = pos.get(b);
    if (pa != null || pb != null) return pa == null ? 1 : pb == null ? -1 : pa - pb;
    return desc ? b.localeCompare(a) : lab(a).localeCompare(lab(b), undefined, { numeric: true, sensitivity: 'base' });
  });
  return ids.map(id => ({ id, label: id ? lab(id) : '', rows: groups.get(id) }));
}

// ---------- 月曆 ----------
// 依筆記的 date 欄位排進月曆。月份用 'YYYY-MM' 字串表示;週日開始。

const pad2 = n => String(n).padStart(2, '0');

/** 'YYYY-MM' 往前後移 n 個月。 */
export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/**
 * 一個月的月曆格子:幾週,每週 7 天(週日開始),前後補上個月、下個月的日子。
 * @returns {{ date: string, day: number, inMonth: boolean }[][]}
 */
export function monthGrid(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first); start.setUTCDate(1 - first.getUTCDay());
  const weeks = [];
  for (let d = new Date(start); weeks.length < 6; ) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === m - 1 });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    weeks.push(week);
    if (d.getUTCMonth() !== m - 1) break;
  }
  return weeks;
}

/** 依日期(date 的前 10 個字)分好的筆記;沒有合法日期的略過。 */
export function rowsByDay(rows) {
  const out = new Map();
  for (const r of rows) {
    const d = String(r.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!out.has(d)) out.set(d, []);
    out.get(d).push(r);
  }
  return out;
}

/** 一開始顯示哪個月:這個月有筆記就是這個月,否則是最近一個有筆記的月份(都沒有就是這個月)。 */
export function defaultMonth(rows, today) {
  const now = String(today).slice(0, 7);
  const months = [...new Set(rows.map(r => String(r.date || '').slice(0, 7)).filter(x => /^\d{4}-\d{2}$/.test(x)))].sort();
  if (!months.length || months.includes(now)) return now;
  const past = months.filter(x => x <= now);
  return past.length ? past.at(-1) : months[0];
}

/** 看板的欄:沒選分組依據時,有 status 欄位就用它,否則用主題。 */
export function kanbanKey(chosen, fieldKeys) {
  if (chosen) return chosen;
  return fieldKeys.includes('status') ? 'status' : 'topic';
}
