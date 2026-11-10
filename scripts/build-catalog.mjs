#!/usr/bin/env node
// 產生 catalog.json:content/ 的資料夾清單,讓網站在 GitHub Pages 上能列出內建的筆記與簡報。
// 同時產生 shell-manifest.js:網站本身的檔案清單與內容雜湊,給 sw.js 預先快取用
// (雜湊變了,瀏覽器就會安裝新版 service worker)。
// GitHub Actions 部署時會自動執行;本機想用 http 伺服器預覽時也可以手動執行:
//   node scripts/build-catalog.mjs

import { writeFile } from 'node:fs/promises';
import { shellFiles, shellManifest } from './shell-files.mjs';
import { nodeSource, walkTree, detectNodeLang } from './node-source.mjs';
import { t, setLang } from '../app/core/i18n.js';

setLang(detectNodeLang());
import { loadDeck } from '../app/core/library.js';
import { openVault, notesOfTopic } from '../app/core/vault.js';

const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--lang');
const root = args[0] || 'content';
const out = args[1] || 'catalog.json';

const source = nodeSource(root);
const tree = await walkTree(source);
const vault = await openVault(source);

// 順便檢查每份簡報,有問題就印出來(不中斷部署;完整檢查請跑 node scripts/check.mjs)
const issues = [...vault.issues];
let decks = 0, slides = 0, notes = 0;
for (const tp of vault.topics) {
  if (tp.notes) notes += notesOfTopic(tp.notes).length;
  for (const p of tp.decks) {
    const d = await loadDeck(vault.slidesSource, p);
    decks++;
    slides += d.sections.reduce((n, s) => n + s.slides.length, 0);
    issues.push(...d.issues);
  }
}

await writeFile(out, JSON.stringify({ version: 1, title: vault.title, generated: new Date().toISOString(), tree }) + '\n');
await writeFile('shell-manifest.js', shellManifest(await shellFiles('.')));
console.log(t('catalog.done', { topics: vault.topics.length, decks, slides, notes }));
for (const i of issues) console.warn(`  ⚠ ${i.path}:${i.message}`);
