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

import { parseYaml } from '../app/core/yaml.js';
import { splitFrontMatter } from '../app/core/note.js';
import { resolvePublic, isLocalOnly, scanPII } from '../app/core/privacy.js';

export const DEFAULT_LIMITS = { image_kb: 300, text_kb: 100, total_mb: 20 };

const IMAGE_EXT = new Set(['.svg', '.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif']);
// .html:簡報裡的互動網頁(沙箱執行,見 docs/slides/GUIDE.zh-Hant.md);和其他文字檔一樣有大小上限
const TEXT_EXT = new Set(['.md', '.yml', '.yaml', '.json', '.canvas', '.html']);
const SAFE_PATH = /^[A-Za-z0-9._\-/]+$/;

/** 取出 Markdown 開頭的 front matter(與網站同一個解析器)。 */
export function frontMatter(md) {
  return splitFrontMatter(md).data;
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
  try {
    const v = parseYaml(readFileSync(path, 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch { return null; }
}

/** 筆記的主題與筆記本設定(公開判斷用 app/core/privacy.js,與網站同一套規則)。 */
function noteContext(root, file, fm) {
  const rel = relative(root, file).split(/[\\/]/);
  if (rel[0] !== 'notes' || rel.length < 3) return { note: fm, book: {}, topic: {} };
  const topic = readYaml(join(root, 'notes', rel[1], '_topic.yml')) || {};
  const book = rel.length >= 4 ? readYaml(join(root, 'notes', rel[1], rel[2], '_book.yml')) || {} : {};
  return { note: fm, book, topic };
}

/** 主程式：回傳 { errors, warnings, stats }。 */
export function guard(root, { today = new Date().toISOString().slice(0, 10) } = {}) {
  root = resolve(root);
  const errors = [], warnings = [];
  const err = (file, msg) => errors.push({ file: relative(root, file) || '.', msg });
  const warn = (file, msg) => warnings.push({ file: relative(root, file) || '.', msg });

  let limits = { ...DEFAULT_LIMITS };
  const site = readYaml(join(root, '_site.yml'));
  if (site?.limits && typeof site.limits === 'object') limits = { ...limits, ...site.limits };

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
      const ctx = noteContext(root, path, fm);
      if (isLocalOnly(ctx.topic)) err(path, '這個主題設定 local_only，只能留在本機，不可放上 GitHub');
      else if (!resolvePublic(ctx)) err(path, '這篇筆記不是公開的（筆記、筆記本或主題設為私人或沒寫）；放上 GitHub 等於公開，請改 public: true 或移回本機');
    }

    if (fm.pinned === true && !fm.expires) warn(path, '急件（pinned）請加上 expires 到期日');
    if (fm.expires && String(fm.expires) < today) warn(path, `已在 ${fm.expires} 到期，請刪除或移到 _archive/`);

    for (const hit of scanPII(text)) warn(path, `可能含有個資（${hit.key}）：「${hit.match}」`);
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
