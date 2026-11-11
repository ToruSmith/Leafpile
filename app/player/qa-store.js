// 現場問答紀錄:講者視窗寫入、主視窗產生講後筆記時讀取。
// 存在 localStorage(同網域的視窗共用、重新整理不會不見),以「書庫/簡報」為鍵。
// 只存問答文字,不碰書庫檔案;產生講後筆記後清空。

const PREFIX = 'leafpile-qa:';

/** @returns {{ q: string, a: string, n?: number, at?: string }[]} */
export function loadQA(key) {
  if (!key) return [];
  try {
    const v = JSON.parse(localStorage.getItem(PREFIX + key) || '[]');
    return Array.isArray(v) ? v.filter(x => x && typeof x.q === 'string') : [];
  } catch { return []; }
}

/** 空陣列 = 刪除紀錄。回傳是否成功(隱私模式或空間滿了會失敗)。 */
export function saveQA(key, list) {
  if (!key) return false;
  try {
    if (list.length) localStorage.setItem(PREFIX + key, JSON.stringify(list));
    else localStorage.removeItem(PREFIX + key);
    return true;
  } catch { return false; }
}
