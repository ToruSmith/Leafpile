#!/usr/bin/env node
// 簡報與來源筆記:列出每份由筆記升級的簡報,來源筆記在升級後有沒有改過(docs/INTEROP.md 第 4 節)。
// 判斷方式是內容指紋(deck.yml 的 source_hash),不看檔案修改時間,所以 git clone、複製資料夾都不影響。
//
//   node scripts/source-sync.mjs <書庫>                     列出狀態
//   node scripts/source-sync.mjs <書庫> <簡報的路徑> --mark  簡報已經跟上了:更新那份簡報的 source_hash
//   node scripts/source-sync.mjs <書庫> --lang en           英文輸出

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { nodeSource, detectNodeLang } from './node-source.mjs';
import { t, setLang } from '../app/core/i18n.js';
import { openVault } from '../app/core/vault.js';
import { buildGraph, sourceStatus } from '../app/core/graph.js';
import { withSourceHash } from '../app/core/bridge.js';

setLang(detectNodeLang());
const argv = process.argv.slice(2);
const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--lang');
if (!pos.length) { console.log(t('sync.usage')); process.exit(1); }

const root = resolve(pos[0]);
const vault = await openVault(nodeSource(root));
if (vault.kind !== 'leafpile') { console.error(t('bridge.needVault')); process.exit(1); }
const graph = await buildGraph(vault, { slides: false });
const decks = [...graph.decks.values()].filter(d => d.source);

if (argv.includes('--mark')) {
  const rel = (pos[1] || '').replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
  const deck = decks.find(d => d.path === rel);
  if (!deck) { console.error(t('sync.notDeck', { path: rel || '?' })); process.exit(1); }
  const st = sourceStatus(graph, deck);
  if (!st.hash) { console.error(t('check.sourceMissing', { source: deck.source })); process.exit(1); }
  const file = join(root, deck.path, 'deck.yml');
  await writeFile(file, withSourceHash(await readFile(file, 'utf8'), st.hash));
  console.log(t('sync.marked', { path: deck.path, hash: st.hash }));
  process.exit(0);
}

if (!decks.length) { console.log(t('sync.none')); process.exit(0); }
let changed = 0;
for (const d of decks) {
  const { status } = sourceStatus(graph, d);
  if (status === 'changed') changed++;
  console.log(`${t('sync.status.' + status)}  ${d.path}  ← ${d.source}`);
}
console.log(changed ? t('sync.changed', { n: changed }) : t('sync.allSame'));
