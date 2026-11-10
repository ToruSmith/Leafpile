// 精簡 YAML 解析器:只支援設定檔需要的子集,零依賴。
//
// 支援:
//   key: value            字串、數字、布林、null、引號字串
//   巢狀物件              以縮排表示
//   - item / - key: v     清單與「物件清單」
//   [a, b, c]             行內陣列
//   key: |                多行文字(保留換行);> 會把換行併成空白
//   # 註解
// 不支援:錨點、標籤、多文件、行內物件 {}。
// 解析失敗時丟出 YamlError(含行號),呼叫端負責轉成使用者看得懂的提示。

import { t } from './i18n.js';

export class YamlError extends Error {
  constructor(message, line) {
    super(line ? t('yaml.line', { line, message }) : message);
    this.line = line;
  }
}

export function parseYaml(text) {
  const lines = [];
  text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, i) => {
    const stripped = stripComment(raw);
    if (!stripped.trim()) { lines.push({ blank: true, raw, no: i + 1 }); return; }
    if (/^\t/.test(raw)) throw new YamlError(t('yaml.tab'), i + 1);
    lines.push({ indent: stripped.match(/^ */)[0].length, text: stripped.trim(), raw, no: i + 1 });
  });
  const state = { lines, i: 0 };
  skipBlank(state);
  if (state.i >= lines.length) return {};
  const value = parseBlock(state, lines[state.i].indent);
  skipBlank(state);
  if (state.i < lines.length) throw new YamlError(t('yaml.inconsistent'), lines[state.i].no);
  return value;
}

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).replace(/\s+$/, '');
  }
  return line.replace(/\s+$/, '');
}

function skipBlank(s) { while (s.i < s.lines.length && s.lines[s.i].blank) s.i++; }

function parseBlock(s, indent) {
  skipBlank(s);
  const first = s.lines[s.i];
  return first.text.startsWith('- ') || first.text === '-' ? parseList(s, indent) : parseMap(s, indent);
}

function parseMap(s, indent) {
  const obj = {};
  while (true) {
    skipBlank(s);
    const ln = s.lines[s.i];
    if (!ln || ln.indent < indent) break;
    if (ln.indent > indent) throw new YamlError(t('yaml.tooDeep'), ln.no);
    if (ln.text.startsWith('- ')) throw new YamlError(t('yaml.notList'), ln.no);
    const m = ln.text.match(/^("[^"]*"|'[^']*'|[^:]+?)\s*:(?:\s+(.*))?$/);
    if (!m) throw new YamlError(t('yaml.unknown', { text: ln.text }), ln.no);
    const key = unquote(m[1]);
    const rest = m[2] ?? '';
    s.i++;
    obj[key] = parseValueAfterKey(s, indent, rest, ln.no);
  }
  return obj;
}

function parseList(s, indent) {
  const arr = [];
  while (true) {
    skipBlank(s);
    const ln = s.lines[s.i];
    if (!ln || ln.indent < indent) break;
    if (ln.indent > indent) throw new YamlError(t('yaml.tooDeep'), ln.no);
    if (!(ln.text.startsWith('- ') || ln.text === '-')) break;
    const rest = ln.text === '-' ? '' : ln.text.slice(2).trim();
    if (!rest) { s.i++; skipBlank(s); arr.push(s.lines[s.i] && s.lines[s.i].indent > indent ? parseBlock(s, s.lines[s.i].indent) : null); continue; }
    // 「- key: value」才算物件;「- https://x」這種冒號後面沒有空白的不算
    if (/^("[^"]*"|'[^']*'|[^"'\[\s][^:]*?)\s*:(\s|$)/.test(rest)) {
      // 物件清單:把「- 」後面當成縮排 +2 的物件第一行
      const childIndent = ln.indent + 2;
      s.lines[s.i] = { ...ln, indent: childIndent, text: rest };
      arr.push(parseMap(s, childIndent));
    } else {
      s.i++;
      arr.push(scalar(rest, ln.no));
    }
  }
  return arr;
}

function parseValueAfterKey(s, indent, rest, no) {
  if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-') return blockScalar(s, indent, rest[0] === '>');
  if (rest !== '') return scalar(rest, no);
  skipBlank(s);
  const next = s.lines[s.i];
  if (next && next.indent > indent) return parseBlock(s, next.indent);
  if (next && next.indent === indent && next.text.startsWith('- ')) return parseList(s, indent);
  return null;
}

function blockScalar(s, indent, fold) {
  const out = [];
  let base = null;
  while (s.i < s.lines.length) {
    const ln = s.lines[s.i];
    if (ln.blank) { out.push(''); s.i++; continue; }
    if (ln.indent <= indent) break;
    if (base == null) base = ln.indent;
    out.push(ln.raw.slice(base));
    s.i++;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return fold ? out.join('\n').replace(/([^\n])\n(?!\n)/g, '$1 ') : out.join('\n');
}

function unquote(v) {
  v = v.trim();
  if (v.length >= 2 && v[0] === '"' && v.at(-1) === '"') return v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  if (v.length >= 2 && v[0] === "'" && v.at(-1) === "'") return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function scalar(v, no) {
  v = v.trim();
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) throw new YamlError(t('yaml.array'), no);
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map(x => scalar(x, no));
  }
  if (/^["']/.test(v)) return unquote(v);
  if (/^(true|yes|on)$/i.test(v)) return true;
  if (/^(false|no|off)$/i.test(v)) return false;
  if (/^(null|~)$/i.test(v)) return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function splitTopLevel(s) {
  const out = []; let cur = '', q = null, depth = 0;
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[') depth++;
    if (c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
