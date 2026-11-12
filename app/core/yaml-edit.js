// 改寫設定檔(_topic.yml、_site.yml)時只動要改的那幾行,保留其他行、註解與順序。
// 只處理最上層的鍵(沒有縮排的 `鍵: 值`),這正是設定檔用到的部分。純邏輯,瀏覽器與測試共用。

const RESERVED = /^(true|false|yes|no|on|off|null|~)$/i;

/**
 * 把值寫成一行 YAML。設定檔的值都是單行,換行與 tab 會換成空白。
 * 字串在需要時加引號:一般用雙引號;內容有反斜線或雙引號時改用單引號(單引號裡只需把 ' 寫成 '')。
 */
export function yamlScalar(v) {
  if (v === true || v === false) return String(v);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ');
  const plain = s !== '' && s === s.trim() && !RESERVED.test(s) && !/^[-+]?(\d|\.\d)/.test(s)
    && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) && !/:(\s|$)|\s#/.test(s);
  if (plain) return s;
  return /[\\"]/.test(s) ? `'${s.replace(/'/g, "''")}'` : `"${s}"`;
}

/** 一行裡 `值  # 註解` 的註解起點(不在引號裡的 ` #`);沒有回 -1。 */
function commentStart(rest) {
  let q = '';
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(rest[i - 1]))) return i;
  }
  return -1;
}

const isTopKey = (line, key) => new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:(\\s|$)`).test(line);
const isTopLevel = line => /^[^\s#-][^:]*:(\s|$)/.test(line);

/**
 * 找最上層某個鍵佔的範圍:[開始行, 結束行)。值寫在下面幾行(縮排、`- ` 清單、區塊中間的註解)都算在內;
 * 區塊後面的空白行與屬於下一段的註解不算。找不到回 null。
 */
export function findBlock(lines, key) {
  const start = lines.findIndex(l => isTopKey(l, key));
  if (start < 0) return null;
  let end = start + 1, last = start + 1;
  for (; end < lines.length; end++) {
    const l = lines[end];
    if (l.trim() === '') continue;
    if (/^[\s-]/.test(l)) { last = end + 1; continue; }
    if (/^#/.test(l)) {
      // 頂格的註解:後面還接著這個區塊的內容才算在區塊裡
      const next = lines.slice(end + 1).find(x => x.trim() !== '' && !/^#/.test(x));
      if (next && /^[\s-]/.test(next)) continue;
    }
    break;
  }
  return [start, last];
}

const split = text => text.replace(/\r\n?/g, '\n').split('\n');
const join = (lines, orig) => { const s = lines.join('\n'); return /\n$/.test(orig) || orig === '' ? (s.endsWith('\n') ? s : s + '\n') : s; };

/**
 * 設定最上層的一個鍵。value 為 undefined 或 null 時拿掉這個鍵。
 * 原本那行行尾的註解會保留;原本寫成多行(區塊)的值整段換掉。不存在就加在檔案最後。
 */
export function setTopKey(text, key, value) {
  const lines = split(text || '');
  if (lines.at(-1) === '') lines.pop();
  const b = findBlock(lines, key);
  const remove = value === undefined || value === null;
  if (!b) {
    if (remove) return text || '';
    lines.push(`${key}: ${yamlScalar(value)}`);
    return join(lines, '\n');
  }
  const [s, e] = b;
  if (remove) { lines.splice(s, e - s); return join(lines, text); }
  const rest = lines[s].slice(lines[s].indexOf(':') + 1);
  const c = commentStart(rest);
  const comment = c >= 0 ? rest.slice(c).trimEnd() : '';
  const head = `${key}: ${yamlScalar(value)}`;
  lines.splice(s, e - s, comment ? `${head}  ${comment}` : head);
  return join(lines, text);
}

/** 一次設定好幾個鍵(依物件的順序)。 */
export const setTopKeys = (text, obj) => Object.entries(obj).reduce((t, [k, v]) => setTopKey(t, k, v), text);

/** 區塊裡有沒有註解(整段改寫時這些註解會不見,預覽時要說)。 */
export function blockComments(text, key) {
  const lines = split(text || '');
  const b = findBlock(lines, key);
  return b ? lines.slice(b[0] + 1, b[1]).filter(l => /^\s*#/.test(l) || commentStart(l.replace(/^[\s-]*[^:]*:/, '')) >= 0).length : 0;
}

/**
 * 整段換掉最上層某個鍵的區塊(例如 categories 清單)。body 是區塊內容的各行(不含 `鍵:` 那行)。
 * 不存在就加在檔案最後(前面空一行)。
 */
export function replaceBlock(text, key, body) {
  const lines = split(text || '');
  if (lines.at(-1) === '') lines.pop();
  const b = findBlock(lines, key);
  const block = [`${key}:`, ...body];
  if (b) lines.splice(b[0], b[1] - b[0], ...block);
  else lines.push(...(lines.length ? [''] : []), ...block);
  return join(lines, '\n');
}

/** _site.yml 的 categories 清單寫成 YAML 各行。 */
export function categoriesYaml(list) {
  return list.flatMap(c => [
    `  - id: ${yamlScalar(String(c.id))}`,
    `    name: ${yamlScalar(c.name || String(c.id))}`,
    ...(c.color ? [`    color: ${yamlScalar(c.color)}`] : []),
  ]);
}

export { isTopLevel };
