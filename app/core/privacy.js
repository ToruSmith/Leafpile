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

// 範例網域與保留網域:文件裡常見,不算個資
const EXAMPLE_MAIL = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/i;

/**
 * 掃描個資,列出每一筆(含行號)。程式碼區塊裡的、範例網域的 Email 不算。
 * @returns {{ key: string, match: string, line: number }[]}  line 從 1 開始
 */
export function scanPIIAll(text) {
  const out = [], seen = new Set();
  let fence = null;
  String(text).split('\n').forEach((line, i) => {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) { if (!fence) fence = f[1]; else if (line.trim().startsWith(fence)) fence = null; return; }
    if (fence) return;
    const plain = line.replace(/`[^`]*`/g, m => ' '.repeat(m.length));
    for (const { key, re } of PII) {
      for (const m of plain.matchAll(new RegExp(re.source, 'g'))) {
        if (key === 'email' && EXAMPLE_MAIL.test(m[0])) continue;
        const id = key + '|' + m[0];
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ key, match: m[0], line: i + 1 });
      }
    }
  });
  return out;
}

/** 螢幕上顯示用:遮掉中間,只留頭尾(截圖時不會整筆外流)。 */
export function maskPII(key, s) {
  const str = String(s);
  if (key === 'email') {
    const [user, domain] = str.split('@');
    return `${user.slice(0, 1)}${'*'.repeat(Math.max(2, user.length - 1))}@${domain}`;
  }
  const keep = Math.min(3, Math.floor(str.length / 4));
  return str.slice(0, keep) + str.slice(keep, str.length - keep).replace(/[A-Za-z0-9]/g, '*') + str.slice(str.length - keep);
}

/**
 * 發布前檢查:哪些筆記會公開、哪些有個資。
 * @param {{ rel: string, title: string, text: string, public: boolean, localOnly: boolean, kind?: 'note'|'slide' }[]} items
 */
export function auditPrivacy(items) {
  const notes = items.filter(i => i.kind !== 'slide');
  const counts = {
    public: notes.filter(n => n.public && !n.localOnly).length,
    private: notes.filter(n => !n.public && !n.localOnly).length,
    localOnly: notes.filter(n => n.localOnly).length,
  };
  const exposed = i => i.kind === 'slide' ? !i.localOnly : i.public && !i.localOnly; // 簡報沒有 public 設定:會跟著書庫公開
  const pii = items.map(i => ({ ...i, exposed: exposed(i), hits: scanPIIAll(i.text) })).filter(i => i.hits.length)
    .map(({ text, ...rest }) => rest)
    .sort((a, b) => Number(b.exposed) - Number(a.exposed) || a.rel.localeCompare(b.rel));
  return { counts, publicNotes: notes.filter(n => n.public && !n.localOnly).map(n => ({ rel: n.rel, title: n.title })), pii };
}

/**
 * 訪客視角:只留下會公開的筆記(書庫的其他結構不變,可以直接交給書架畫面)。
 * 只留本機的主題裡的簡報也拿掉。
 * @param {object} vault  core/vault.js 的書庫物件
 * @param {(rel: string) => boolean} visible  這篇筆記訪客看不看得到
 */
export function visitorVault(vault, visible) {
  const keep = nt => nt && {
    ...nt,
    items: nt.items
      .map(i => (i.kind === 'book' ? { ...i, notes: i.notes.filter(n => visible(n.path)) } : i))
      .filter(i => (i.kind === 'book' ? i.notes.length : visible(i.path))),
  };
  const notesTopics = (vault.notes?.topics || []).map(keep);
  const byId = new Map(notesTopics.map(x => [x.id, x]));
  const topics = vault.topics.map(tp => {
    const local = isLocalOnly(tp.conf) || isLocalOnly(tp.notes?.conf);
    return { ...tp, notes: tp.notes ? byId.get(tp.notes.id) : tp.notes, decks: local ? [] : tp.decks };
  });
  const byTopic = new Map(topics.map(x => [x.id, x]));
  return {
    ...vault,
    topics,
    notes: vault.notes ? { ...vault.notes, topics: notesTopics } : vault.notes,
    categories: (vault.categories || []).map(c => ({ ...c, topics: c.topics.map(tp => byTopic.get(tp.id) || tp) })),
  };
}
