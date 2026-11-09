#!/usr/bin/env node
// guard-content.mjs — 推上 GitHub 前的守門檢查（零依賴，Node 18+）。
//
// GitHub Pages 一律公開，所以 content/ 裡的東西都會被任何人看到。
// 這支腳本確保：檔案小、路徑是 ASCII、沒有影片與 PDF、沒有私人筆記、急件有到期日。
//
// 用法：
//   node scripts/guard-content.mjs [資料夾=content] [--json] [--today=YYYY-MM-DD]
// 結束碼：有錯誤 = 1；只有警告 = 0。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_LIMITS = { image_kb: 300, text_kb: 100, total_mb: 20 };

const IMAGE_EXT = new Set(['.svg', '.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif']);
const TEXT_EXT = new Set(['.md', '.yml', '.yaml', '.json', '.canvas']);
const SAFE_PATH = /^[A-Za-z0-9._\-/]+$/;

// 個資樣式（沿用讀書筆記 Vault 的個資掃描精神）：只警告、不阻擋。
const PII = [
  { key: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { key: 'phone', re: /(?<!\d)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/ },
  { key: 'tw-id', re: /(?<![A-Za-z0-9])[A-Z][12]\d{8}(?!\d)/ }
];

/** 精簡 YAML：只讀第一層的 `key: value`（值可為 true/false/數字/字串/[a, b]），足夠守門使用。 */
export function parseFlatYaml(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s/.test(raw) || /^\s*(#|$)/.test(raw)) continue;
    const m = raw.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = scalar(m[2]);
  }
  return out;
}

/** 讀出某個區塊底下第二層的 `key: value`，例如 _site.yml 的 limits。 */
export function parseBlock(text, name) {
  const out = {};
  let inside = false;
  for (const raw of text.split(/\r?\n/)) {
    if (!/^\s/.test(raw) && raw.trim()) inside = raw.startsWith(name + ':');
    else if (inside) {
      const m = raw.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/);
      if (m) out[m[1]] = scalar(m[2]);
    }
  }
  return out;
}

function scalar(v) {
  v = v.replace(/\s+#.*$/, '').trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
  return v.replace(/^["']|["']$/g, '');
}

/** 取出 Markdown 開頭的 front matter。 */
export function frontMatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return m ? parseFlatYaml(m[1]) : {};
}

function walk(dir, list = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, list);
    else list.push({ path: p, size: st.size });
  }
  return list;
}

function readYaml(path) {
  try { return parseFlatYaml(readFileSync(path, 'utf8')); } catch { return null; }
}

/**
 * 筆記是否公開：筆記 > 筆記本（_book.yml）> 主題（_topic.yml）> 私人。
 * 也回傳主題是否 local_only。
 */
function noteVisibility(root, file, fm) {
  const rel = relative(root, file).split(/[\\/]/);
  const out = { public: undefined, localOnly: false };
  // rel = ['notes', '<topic>', ...]
  if (rel[0] !== 'notes' || rel.length < 3) return { public: fm.public === true, localOnly: false };
  const topic = readYaml(join(root, 'notes', rel[1], '_topic.yml')) || {};
  out.localOnly = topic.local_only === true;
  let book = {};
  if (rel.length >= 4) book = readYaml(join(root, 'notes', rel[1], rel[2], '_book.yml')) || {};
  for (const v of [fm.public, book.public, topic.public]) {
    if (typeof v === 'boolean') { out.public = v; break; }
  }
  if (out.public === undefined) out.public = false;
  return out;
}

/** 主程式：回傳 { errors, warnings, stats }。 */
export function guard(root, { today = new Date().toISOString().slice(0, 10) } = {}) {
  root = resolve(root);
  const errors = [], warnings = [];
  const err = (file, msg) => errors.push({ file: relative(root, file) || '.', msg });
  const warn = (file, msg) => warnings.push({ file: relative(root, file) || '.', msg });

  let limits = { ...DEFAULT_LIMITS };
  try {
    const site = readFileSync(join(root, '_site.yml'), 'utf8');
    limits = { ...limits, ...parseBlock(site, 'limits') };
  } catch { /* _site.yml 可省略 */ }

  const files = walk(root);
  let total = 0;
  for (const { path, size } of files) {
    total += size;
    const rel = relative(root, path).split('\\').join('/');
    const ext = extname(path).toLowerCase();

    if (!SAFE_PATH.test(rel)) err(path, '路徑只能用英文字母、數字、- _ . /（中文請寫在 yml 的 name 或 title）');

    if (IMAGE_EXT.has(ext)) {
      if (size > limits.image_kb * 1024) err(path, `圖片 ${Math.ceil(size / 1024)} KB，超過上限 ${limits.image_kb} KB；請壓縮或改用連結`);
    } else if (TEXT_EXT.has(ext)) {
      if (size > limits.text_kb * 1024) err(path, `文字檔 ${Math.ceil(size / 1024)} KB，超過上限 ${limits.text_kb} KB；請拆成多篇`);
    } else {
      err(path, `不允許的檔案類型「${ext || basename(path)}」：影片、PDF、壓縮檔請放雲端，只在筆記裡放連結`);
      continue;
    }

    if (ext !== '.md') continue;
    const text = readFileSync(path, 'utf8');
    const fm = frontMatter(text);
    const isNote = rel.startsWith('notes/');

    if (isNote) {
      const vis = noteVisibility(root, path, fm);
      if (vis.localOnly) err(path, '這個主題設定 local_only，只能留在本機，不可放上 GitHub');
      else if (!vis.public) err(path, '這篇筆記不是公開的（筆記、筆記本或主題設為私人或沒寫）；放上 GitHub 等於公開，請改 public: true 或移回本機');
    }

    if (fm.pinned === true && !fm.expires) warn(path, '急件（pinned）請加上 expires 到期日');
    if (fm.expires && String(fm.expires) < today) warn(path, `已在 ${fm.expires} 到期，請刪除或移到 _archive/`);

    const body = text.replace(/```[\s\S]*?```/g, '');
    for (const { key, re } of PII) {
      const hit = body.match(re);
      if (hit) warn(path, `可能含有個資（${key}）：「${hit[0]}」`);
    }
  }

  if (total > limits.total_mb * 1024 * 1024) {
    err(root, `content 總量 ${(total / 1048576).toFixed(1)} MB，超過上限 ${limits.total_mb} MB`);
  }
  return { errors, warnings, stats: { files: files.length, bytes: total, limits } };
}

// ── 命令列 ──
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const dir = args.find(a => !a.startsWith('--')) || join(dirname(fileURLToPath(import.meta.url)), '..', 'content');
  const today = (args.find(a => a.startsWith('--today=')) || '').slice(8) || undefined;
  const res = guard(dir, { today });
  if (args.includes('--json')) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    const kb = (res.stats.bytes / 1024).toFixed(0);
    console.log(`Leafpile 守門檢查：${res.stats.files} 個檔案，共 ${kb} KB（上限 ${res.stats.limits.total_mb} MB）`);
    for (const e of res.errors) console.log(`  ✗ ${e.file}：${e.msg}`);
    for (const w of res.warnings) console.log(`  ! ${w.file}：${w.msg}`);
    if (!res.errors.length && !res.warnings.length) console.log('  ✓ 沒有問題');
    else console.log(`  錯誤 ${res.errors.length}、警告 ${res.warnings.length}`);
  }
  process.exit(res.errors.length ? 1 : 0);
}
