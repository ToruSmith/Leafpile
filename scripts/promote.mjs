#!/usr/bin/env node
// 升級成簡報:把一篇筆記(或整本筆記本)複製成一份新簡報的骨架(docs/INTEROP.md 第 4 節)。
// 這是一次性的複製:之後筆記與簡報各自獨立,不會自動同步。已存在的資料夾不會被覆蓋。
//
//   node scripts/promote.mjs <書庫> <筆記或筆記本的路徑>     例:node scripts/promote.mjs ~/我的頁堆 notes/10-reading/2026-11-book/01-ch1.md
//   node scripts/promote.mjs <書庫> <路徑> --dry-run          只列出會建立的檔案,不寫入
//   node scripts/promote.mjs <書庫> <路徑> --author "名字"     寫進 deck.yml
//   node scripts/promote.mjs <書庫> <路徑> --lang en           命令列訊息的語言

import { mkdir, writeFile, readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { detectNodeLang } from './node-source.mjs';
import { t, setLang } from '../app/core/i18n.js';
import { parseNote } from '../app/core/note.js';
import { parseYaml } from '../app/core/yaml.js';
import { isMarkdown, byOrder, splitOrder } from '../app/core/names.js';
import { promoteNote, promoteBook } from '../app/core/bridge.js';

setLang(detectNodeLang());
const argv = process.argv.slice(2);
const flags = new Set(['--lang', '--author']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !flags.has(argv[i - 1]));
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
if (pos.length < 2) { console.log(t('promote.usage')); process.exit(1); }

const root = resolve(pos[0]);
const rel = pos[1].replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
const parts = rel.split('/');
const info = parts[0] === 'notes' && parts.length >= 2 ? await stat(join(root, rel)).catch(() => null) : null;
if (!info) { console.error(t('promote.notNote', { path: rel })); process.exit(1); }

const topic = parts.length >= 3 ? parts[1] : '';
const opts = { source: rel, author: opt('--author') || '' };
let result;
if (info.isDirectory()) {
  const names = (await readdir(join(root, rel))).filter(isMarkdown).map(name => ({ name })).sort(byOrder).map(e => e.name);
  const notes = await Promise.all(names.map(async n => parseNote(await readFile(join(root, rel, n), 'utf8'), { path: `${rel}/${n}` })));
  let conf = {};
  try { conf = parseYaml(await readFile(join(root, rel, '_book.yml'), 'utf8')) || {}; } catch { /* _book.yml 可省略 */ }
  result = promoteBook({ title: String(conf.title || splitOrder(parts.at(-1)).label), notes }, { ...opts, author: opts.author || String(conf.author || ''), lang: notes[0]?.lang || '', tags: Array.isArray(conf.tags) ? conf.tags.map(String) : [] });
} else {
  result = promoteNote(parseNote(await readFile(join(root, rel), 'utf8'), { path: rel }), opts);
}

const target = ['slides', topic, result.folder].filter(Boolean).join('/');
if (await stat(join(root, target)).catch(() => null)) { console.error(t('promote.exists', { path: target })); process.exit(1); }
const dry = argv.includes('--dry-run');
for (const [file, text] of Object.entries(result.files)) {
  if (dry) { console.log(`  ${target}/${file}`); continue; }
  await mkdir(dirname(join(root, target, file)), { recursive: true });
  await writeFile(join(root, target, file), text);
}
console.log(dry ? t('promote.dry') : t('promote.done', { path: target, sections: result.sections, slides: result.slides }));
