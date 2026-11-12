// 主題管理(設定類):改 _topic.yml、_site.yml 的規則與預覽。純邏輯,瀏覽器與測試共用。
// 只產生「新的檔案內容」與「改了什麼」的清單;真正寫檔由呼叫端做(先給使用者看預覽)。

import { parseYaml } from './yaml.js';
import { setTopKey, replaceBlock, categoriesYaml, blockComments } from './yaml-edit.js';
import { splitOrder } from './names.js';

export const topicConfPath = id => `notes/${id}/_topic.yml`;

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const validColor = c => !c || COLOR.test(c);

/**
 * 主題資料夾名稱能不能用。回傳錯誤代碼(給 i18n 用),可以用就回 null。
 * 規則:不空、不含路徑符號與 Windows 不允許的字、不以 . 或 _ 開頭(_ 留給系統)、不和現有主題重複(不分大小寫)。
 */
export function topicIdError(id, existing = []) {
  const s = String(id ?? '').trim();
  if (!s) return 'empty';
  if (s !== String(id)) return 'spaces';
  if (/[\\/:*?"<>|#\0]/.test(s) || /[\s.]$/.test(s)) return 'chars';
  if (/^[._]/.test(s)) return 'reserved';
  if (s.length > 80) return 'long';
  if (existing.some(x => String(x).toLowerCase() === s.toLowerCase())) return 'exists';
  return null;
}

/** 建議新主題的資料夾名稱前綴:現有最大的數字前綴再加 10(取整十),例如有 50-life 就建議 60-。 */
export function suggestTopicPrefix(ids) {
  const nums = ids.map(id => /^(\d+)-/.exec(id)).filter(Boolean).map(m => Number(m[1]));
  if (!nums.length) return '10-';
  const width = Math.max(2, ...ids.map(id => (/^(\d+)-/.exec(id)?.[1].length) || 0));
  const next = Math.floor(Math.max(...nums) / 10) * 10 + 10;
  return String(next).padStart(width, '0') + '-';
}

/** 新主題的 _topic.yml 內容。 */
export function newTopicYaml({ name, description = '', category = '', color = '' }) {
  let text = '';
  text = setTopKey(text, 'name', name);
  if (description) text = setTopKey(text, 'description', description);
  if (category) text = setTopKey(text, 'category', category);
  if (color) text = setTopKey(text, 'color', color);
  return text;
}

const norm = v => (v === undefined || v === null || v === '' ? '' : v);

/**
 * 編輯主題設定。next 的欄位:name、description、category、color、public(true／false／'' 表示不設定)。
 * 只改和原本不同的鍵;原檔用 title 而不是 name 時,改 title。
 * @returns {{ text: string, changes: { key: string, from: any, to: any }[] }}
 */
export function planTopicEdit(oldText, next, folderId) {
  const conf = (oldText && parseYaml(oldText)) || {};
  const nameKey = conf.name == null && conf.title != null ? 'title' : 'name';
  const currentName = norm(conf.name ?? conf.title);
  const changes = [];
  let text = oldText || '';
  const want = {
    // 名稱和資料夾預設名稱一樣、原本也沒寫時,就不寫進檔案
    [nameKey]: next.name === splitOrder(folderId).label && !currentName ? '' : norm(next.name),
    description: norm(next.description),
    category: norm(next.category),
    color: norm(next.color),
    public: next.public === true || next.public === false ? next.public : '',
  };
  const from = { [nameKey]: currentName, description: norm(conf.description), category: norm(conf.category), color: norm(conf.color), public: typeof conf.public === 'boolean' ? conf.public : '' };
  for (const [k, v] of Object.entries(want)) {
    if (String(from[k]) === String(v)) continue;
    changes.push({ key: k, from: from[k], to: v });
    text = setTopKey(text, k, v === '' ? null : v);
  }
  return { text, changes };
}

/**
 * 分類清單的改動(_site.yml 的 categories)。next:[{ id, name, color }],順序就是新的順序。
 * 有主題還在用的分類不能刪(回傳 blocked)。
 * @returns {{ text: string, changes: object[], blocked: { id: string, topics: string[] }[], lostComments: number }}
 */
export function planCategories(oldText, next, topics = []) {
  const old = (parseYaml(oldText || '') || {}).categories;
  const before = Array.isArray(old) ? old.filter(c => c && c.id != null).map(c => ({ id: String(c.id), name: String(c.name ?? c.id), color: c.color ? String(c.color) : '' })) : [];
  const nextIds = new Set(next.map(c => c.id));
  const blocked = before.filter(c => !nextIds.has(c.id))
    .map(c => ({ id: c.id, topics: topics.filter(tp => tp.category === c.id).map(tp => tp.title) }))
    .filter(b => b.topics.length);
  const changes = [];
  const byId = new Map(before.map(c => [c.id, c]));
  for (const c of before) if (!nextIds.has(c.id)) changes.push({ type: 'remove', id: c.id, name: c.name });
  for (const c of next) {
    const o = byId.get(c.id);
    if (!o) { changes.push({ type: 'add', id: c.id, name: c.name }); continue; }
    if (o.name !== c.name) changes.push({ type: 'rename', id: c.id, from: o.name, to: c.name });
    if ((o.color || '') !== (c.color || '')) changes.push({ type: 'color', id: c.id, name: c.name, from: o.color, to: c.color });
  }
  const kept = before.filter(c => nextIds.has(c.id)).map(c => c.id), order = next.filter(c => byId.has(c.id)).map(c => c.id);
  if (kept.join('\n') !== order.join('\n')) changes.push({ type: 'order', ids: next.map(c => c.id) });
  const text = changes.length ? replaceBlock(oldText || '', 'categories', categoriesYaml(next)) : (oldText || '');
  return { text, changes, blocked, lostComments: changes.length ? blockComments(oldText || '', 'categories') : 0 };
}

/** 分類 id 能不能用:不空、只用英數、- 與 _,不重複。 */
export function categoryIdError(id, existing = []) {
  const s = String(id ?? '');
  if (!s.trim()) return 'empty';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s)) return 'chars';
  if (existing.includes(s)) return 'exists';
  return null;
}
