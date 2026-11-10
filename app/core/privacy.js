// 公開與私人:唯一的判斷規則。網站、守門腳本、匯出都呼叫這裡(docs/SPEC.md 第 6 節)。
//   筆記 front matter 的 public → 筆記本 _book.yml → 主題 _topic.yml → 私人
//   主題設定 local_only: true → 不管 public 寫什麼,都不能放上 GitHub

const bool = v => typeof v === 'boolean' ? v : undefined;

/** @returns {boolean} 這篇筆記是否公開 */
export function resolvePublic({ note = {}, book = {}, topic = {} } = {}) {
  for (const v of [note.public, book?.public, topic?.public]) {
    const b = bool(v);
    if (b !== undefined) return b;
  }
  return false;
}

/** 主題是否只留在本機。 */
export const isLocalOnly = topic => topic?.local_only === true || topic?.localOnly === true;

/**
 * 這篇筆記能不能放上公開的地方(GitHub、匯出給別人)。
 * @returns {{ ok: boolean, reason: '' | 'local-only' | 'private' }}
 */
export function publishable(ctx) {
  if (isLocalOnly(ctx.topic)) return { ok: false, reason: 'local-only' };
  if (!resolvePublic(ctx)) return { ok: false, reason: 'private' };
  return { ok: true, reason: '' };
}

// 個資樣式(沿用讀書筆記 Vault 的個資掃描):只用來提醒,不自動擋下。
export const PII = [
  { key: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { key: 'phone', re: /(?<!\d)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/ },
  { key: 'tw-id', re: /(?<![A-Za-z0-9])[A-Z][12]\d{8}(?!\d)/ },
];

/** 掃描個資(程式碼區塊裡的不算)。每種樣式只回報第一個。 */
export function scanPII(text) {
  const body = String(text).replace(/(```|~~~)[\s\S]*?\1/g, '');
  const out = [];
  for (const { key, re } of PII) {
    const m = body.match(re);
    if (m) out.push({ key, match: m[0] });
  }
  return out;
}
