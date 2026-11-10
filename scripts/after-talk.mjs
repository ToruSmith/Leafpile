#!/usr/bin/env node
// 講後筆記:把一份簡報的大綱與講者備註存成一篇新筆記(docs/INTEROP.md 第 5 節)。
// 新筆記放在 notes/<同名主題>/,front matter 記錄 from_deck,預設私人。已存在的檔案不會被覆蓋。
//
//   node scripts/after-talk.mjs <書庫> <簡報的路徑>     例:node scripts/after-talk.mjs ~/我的頁堆 slides/10-reading/2026-11-share
//   node scripts/after-talk.mjs <書庫> <路徑> --dry-run   只印出內容,不寫入

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { nodeSource, detectNodeLang } from './node-source.mjs';
import { t, setLang } from '../app/core/i18n.js';
import { loadDeck } from '../app/core/library.js';
import { openVault } from '../app/core/vault.js';
import { distillDeck } from '../app/core/bridge.js';

setLang(detectNodeLang());
const argv = process.argv.slice(2);
const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--lang');
if (pos.length < 2) { console.log(t('distill.usage')); process.exit(1); }

const root = resolve(pos[0]);
const rel = pos[1].replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
const vault = await openVault(nodeSource(root));
const parts = rel.split('/');
const topic = vault.kind === 'leafpile' && parts[0] === 'slides' && parts.length === 3 ? vault.slides.topics.find(tp => tp.id === parts[1]) : null;
const project = topic?.projects.find(p => p.folder === parts[2]);
if (!project) { console.error(t('distill.notDeck', { path: rel })); process.exit(1); }

const deck = await loadDeck(vault.slidesSource, project);
const { file, text } = distillDeck(deck, { deckPath: rel });
const target = `notes/${parts[1]}/${file}`;
if (argv.includes('--dry-run')) { console.log(text); console.log(t('promote.dry')); process.exit(0); }
if (await stat(join(root, target)).catch(() => null)) { console.error(t('promote.exists', { path: target })); process.exit(1); }
await mkdir(dirname(join(root, target)), { recursive: true });
await writeFile(join(root, target), text);
console.log(t('distill.done', { path: target }));
