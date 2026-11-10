#!/usr/bin/env node
// 建立一份新簡報的骨架:deck.yml、三個章節、每章一張起手投影片。
// 產生完會自動跑一次檢查。
//
//   node scripts/new-deck.mjs <資料夾>                       例:node scripts/new-deck.mjs content/02-工作報告/2026-11-Q4週報
//   node scripts/new-deck.mjs <資料夾> --title "標題"         標題(預設用資料夾名稱)
//   node scripts/new-deck.mjs <資料夾> --deck-lang en         簡報內容的語言(zh-Hant / en;預設依標題判斷)
//   node scripts/new-deck.mjs <資料夾> --lang en              命令列訊息的語言

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { nodeSource, detectNodeLang } from './node-source.mjs';
import { checkLibrary, formatReport } from '../app/core/check.js';
import { t, setLang, detectDeckLang } from '../app/core/i18n.js';
import { splitOrder } from '../app/core/names.js';

setLang(detectNodeLang());

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const dir = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!dir) { console.log(t('scaffold.usage')); process.exit(1); }

const exists = await readdir(dir).then(list => list.filter(n => !n.startsWith('.')).length > 0, () => false);
if (exists) { console.error(t('scaffold.notEmpty', { dir })); process.exit(1); }

const folderTitle = splitOrder(basename(dir)).label || basename(dir);
const title = opt('--title') || folderTitle;
const lang = detectDeckLang(opt('--deck-lang'), title, folderTitle);
const L = key => t(key, null, lang); // 骨架內容用簡報的語言
const yamlText = s => JSON.stringify(String(s)); // JSON 字串也是合法的 YAML 字串
const today = new Date().toISOString().slice(0, 10);

const sections = [
  { folder: L('scaffold.sec1Folder'), title: L('scaffold.sec1Title'), slides: { [L('scaffold.slide1File')]: L('scaffold.slide1') } },
  { folder: L('scaffold.sec2Folder'), title: L('scaffold.sec2Title'), slides: { [L('scaffold.slide2File')]: L('scaffold.slide2'), [L('scaffold.slide3File')]: L('scaffold.slide3') } },
  { folder: L('scaffold.sec3Folder'), title: L('scaffold.sec3Title'), slides: { [L('scaffold.slide4File')]: L('scaffold.slide4') } },
];

const deckYml = `mdslide: 1
lang: ${lang}
title: ${yamlText(title)}
subtitle: ${yamlText(L('scaffold.subtitle'))}
date: ${today}
theme: paper
layout:
  stage: pile
end: ${yamlText(L('scaffold.end'))}
sections:
${sections.map(s => `  - folder: ${yamlText(s.folder)}\n    title: ${yamlText(s.title)}`).join('\n')}
`;

await mkdir(join(dir, 'media'), { recursive: true });
await writeFile(join(dir, 'deck.yml'), deckYml);
for (const s of sections) {
  await mkdir(join(dir, s.folder), { recursive: true });
  for (const [file, body] of Object.entries(s.slides)) await writeFile(join(dir, s.folder, file), body + '\n');
}

console.log(t('scaffold.done', { dir }));
const report = await checkLibrary(nodeSource(dir));
console.log(formatReport(report));
console.log(t('scaffold.next'));
if (report.problems.length) process.exitCode = 1;
