// 程式碼上色:精簡的 tokenizer,支援 js / ts / python / json / bash / sql。
// 輸出一律先跳脫 HTML,只加上 <span class="tk-…">;不認得的語言就原樣跳脫輸出。

const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KEYWORDS = {
  js: 'await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield async',
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print self',
  bash: 'if then else elif fi for while do done case esac in function return export local echo cd exit set unset source sudo',
  sql: 'select from where and or not insert into values update set delete create table drop alter join left right inner outer on group by order having limit offset as distinct null is in like between union all case when then else end primary key',
  json: 'true false null',
};
KEYWORDS.ts = KEYWORDS.js + ' interface type enum implements private public protected readonly declare namespace keyof any number string boolean void never unknown';

const ALIASES = { javascript: 'js', mjs: 'js', jsx: 'js', typescript: 'ts', tsx: 'ts', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', postgres: 'sql', mysql: 'sql' };

const COMMENT = {
  js: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`, ts: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`,
  python: '#[^\\n]*', bash: '#[^\\n]*', sql: '--[^\\n]*', json: null,
};
const STRING = {
  js: String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\x60(?:\\.|[^\x60\\])*\x60`,
  python: String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'`,
  bash: String.raw`"(?:\\.|[^"\\])*"|'[^']*'`,
  sql: String.raw`'(?:''|[^'])*'`,
  json: String.raw`"(?:\\.|[^"\\\n])*"`,
};
STRING.ts = STRING.js;

const cache = new Map();
function tokenizer(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const parts = [];
  if (COMMENT[lang]) parts.push(`(?<c>${COMMENT[lang]})`);
  parts.push(`(?<s>${STRING[lang]})`);
  parts.push(String.raw`(?<n>\b\d+(?:\.\d+)?\b)`);
  parts.push(String.raw`(?<w>[A-Za-z_$][\w$]*)`);
  const re = new RegExp(parts.join('|'), 'g');
  const kw = new Set(KEYWORDS[lang].split(' '));
  const t = { re, kw, ci: lang === 'sql' };
  cache.set(lang, t);
  return t;
}

/** 回傳上色後(已跳脫)的 HTML。lang 不支援時回傳單純跳脫的文字。 */
export function highlight(code, lang) {
  const key = ALIASES[String(lang || '').toLowerCase()] || String(lang || '').toLowerCase();
  if (!KEYWORDS[key]) return esc(code);
  const { re, kw, ci } = tokenizer(key);
  let out = '', last = 0;
  re.lastIndex = 0;
  for (let m; (m = re.exec(code));) {
    out += esc(code.slice(last, m.index));
    const g = m.groups;
    if (g.c) out += `<span class="tk-c">${esc(g.c)}</span>`;
    else if (g.s) out += `<span class="tk-s">${esc(g.s)}</span>`;
    else if (g.n) out += `<span class="tk-n">${g.n}</span>`;
    else if (g.w && kw.has(ci ? g.w.toLowerCase() : g.w)) out += `<span class="tk-k">${esc(g.w)}</span>`;
    else out += esc(m[0]);
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}
