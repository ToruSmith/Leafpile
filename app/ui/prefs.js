// 本機偏好設定(localStorage)集中在這裡。
// 鍵名一律以 leafpile- 開頭;讀不到、壞資料或隱私模式時回預設值,寫入失敗就靜靜略過。
// 這些設定只屬於這個瀏覽器,不寫進書庫檔案。
//
// 目前用到的鍵(新增時請補在這裡):
//   leafpile-lang              介面語言(main.js、presenter.js、standalone.js)
//   leafpile-note-scale        筆記字級(reader.js)
//   leafpile-shelf-view        書庫顯示:全部／筆記／簡報／表格(shelf.js)
//   leafpile-table-sort        表格排序(shelf.js)
//   leafpile-table-mode        表格看筆記或主題(shelf.js、sidebar.js)
//   leafpile-table-group       表格的分組依據(shelf.js)
//   leafpile-table-fold        表格裡收起來的組(shelf.js)
//   leafpile-board-minimap     畫布小地圖開關(canvas-view.js)
//   leafpile-board-pin         畫布工具列固定(canvas-view.js)
//   leafpile-side              側邊欄收合狀態(sidebar.js)
//   leafpile-nav:<書庫>        側邊欄的釘選與最近開過(sidebar.js)
//   leafpile-motion            簡報動畫(player.js)
//   leafpile-qa:<書庫/簡報>    講者問答(qa-store.js)
//   leafpile-draft:…           編輯中的草稿(editor.js)

/** 讀文字;沒有或讀不到回 fallback。 */
export function readPref(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}

/** 寫文字;value 為 null 時刪除。 */
export function writePref(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, String(value)); } catch { /* 隱私模式或空間不足 */ }
}

/** 是非開關,存成 '1' / '0'。 */
export const readFlag = (key, fallback = false) => { const v = readPref(key); return v == null ? fallback : v === '1'; };
export const writeFlag = (key, on) => writePref(key, on ? '1' : '0');

/** JSON;壞資料回 fallback。 */
export function readJSON(key, fallback = null) {
  const v = readPref(key);
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}
export const writeJSON = (key, value) => writePref(key, JSON.stringify(value));
