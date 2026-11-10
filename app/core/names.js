// 檔名與路徑的共用規則。瀏覽器與 Node 腳本都會用到,請保持零依賴。

/** 以 `/` 串接路徑片段,忽略空字串。 */
export function join(...parts) {
  return parts.filter(p => p !== '' && p != null).join('/').replace(/\/+/g, '/');
}

/** 取得副檔名(小寫、不含點)。 */
export function ext(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** 底線或點開頭 = 草稿或系統檔,解析時略過(設定檔另外處理)。 */
export function isHidden(name) {
  return name.startsWith('.') || name.startsWith('_');
}

/** 保留名稱:這些資料夾只放素材,不會被當成章節。 */
export const RESERVED_DIRS = new Set(['media', 'assets', 'images', 'img', 'video', 'videos', 'node_modules']);

/** 不當成投影片的 MD 檔(說明文件)。 */
export function isDocFile(name) {
  return /^(readme|agents|claude|license|changelog)(\..*)?$/i.test(name);
}

export function isMarkdown(name) {
  return ext(name) === 'md' && !isHidden(name) && !isDocFile(name);
}

/**
 * 拆出排序前綴:`01-問題` → { order: 1, label: '問題' }。
 * 沒有前綴時 order 為 null,label 為原名(去掉副檔名)。
 */
export function splitOrder(name) {
  const base = name.replace(/\.(md|ya?ml)$/i, '');
  // 日期前綴 `2026-11-筆記`、`2026-11-20 讀書會`:不是排序數字,而是日期
  const d = base.match(/^(\d{4}-\d{2}(?:-\d{2})?)[\s._-]+(.+)$/);
  if (d) return { order: null, date: d[1], label: d[2].trim() };
  const m = base.match(/^(\d+)[\s._-]+(.+)$/);
  return m ? { order: Number(m[1]), label: m[2].trim() } : { order: null, label: base };
}

/** 依前綴數字排序,沒有前綴的依名稱排在後面。 */
export function byOrder(a, b) {
  const A = splitOrder(a.name), B = splitOrder(b.name);
  if (A.order != null && B.order != null && A.order !== B.order) return A.order - B.order;
  if (A.order != null && B.order == null) return -1;
  if (A.order == null && B.order != null) return 1;
  return a.name.localeCompare(b.name, 'zh-Hant', { numeric: true });
}

/** 連結是否為外部網址。 */
export function isURL(s) {
  return /^(https?:)?\/\//i.test(s) || /^data:/i.test(s);
}
