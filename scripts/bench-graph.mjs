#!/usr/bin/env node
// 圖譜的效能量測:產生 N 篇筆記的書庫(在記憶體裡),量開啟書庫、建立圖譜、搜尋的時間。
// 只量解析與計算(不含瀏覽器讀檔);瀏覽器實測的數字記在 docs/ROADMAP.md。
//
//   node scripts/bench-graph.mjs [筆記數=1000]

import { performance } from 'node:perf_hooks';
import { openVault } from '../app/core/vault.js';
import { buildGraph, searchGraph } from '../app/core/graph.js';
import { memorySource } from '../tests/helpers.mjs';

const N = Number(process.argv[2]) || 1000;
const topics = ['10-reading', '11-courses', '20-reports', '21-meetings', '30-markets', '40-reference'];
const files = {};
const title = i => `note-${String(i).padStart(5, '0')}`;
for (let i = 0; i < N; i++) {
  const links = [1, 2, 3].map(k => `[[${title((i * 7 + k * 131) % N)}]]`).join(' ');
  const body = [0, 1, 2, 3].map(k => `## Section ${k}\n${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(6)}`).join('\n\n');
  files[`notes/${topics[i % topics.length]}/2026-01-01-${title(i)}.md`] = `---\ntitle: ${title(i)}\ntags: [bench, t${i % 20}]\n---\n# ${title(i)}\n\n${links}\n\n${body}\n`;
}
const src = memorySource(files);
const time = async (label, fn) => { const t = performance.now(); const r = await fn(); console.log(`${label.padEnd(12)} ${(performance.now() - t).toFixed(0).padStart(6)} ms`); return r; };
console.log(`${N} notes, ${Math.round(Object.values(files).reduce((s, x) => s + x.length, 0) / 1024)} KB`);
const vault = await time('openVault', () => openVault(src));
const g = await time('buildGraph', () => buildGraph(vault));
await time('search x100', async () => { for (let i = 0; i < 100; i++) searchGraph(g, `note-${String(i * 9).padStart(5, '0')} lorem`); });
console.log(`backlinks: ${[...g.backlinks.values()].reduce((s, l) => s + l.length, 0)}`);
