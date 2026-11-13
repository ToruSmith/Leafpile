#!/usr/bin/env node
// 檢查一個資料夾(書庫、主題或單一簡報)是否符合規則,並印出結構摘要。
// 給人用,也給 AI 用:做完簡報後先跑這個,確認沒有警告再交付。
// 規則本身在 app/core/check.js(網站的「檢查」按鈕用的是同一份)。
//
//   node scripts/check.mjs <資料夾>           例:node scripts/check.mjs content
//   node scripts/check.mjs <資料夾> --slides  連每張投影片的版型與標題都列出來
//   node scripts/check.mjs <資料夾> --lang en  英文輸出(預設依作業系統語言)
//   node scripts/check.mjs <資料夾> --index    印出書庫索引(Markdown;--index=json 輸出 JSON;加 --public 只列公開筆記)

import { nodeSource, detectNodeLang } from './node-source.mjs';
import { checkVault, formatReport } from '../app/core/check.js';
import { libraryIndex, indexMarkdown } from '../app/core/index.js';
import { t, setLang } from '../app/core/i18n.js';

setLang(detectNodeLang());

const args = process.argv.slice(2);
const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--lang');
if (!dir) { console.log(t('check.usage')); process.exit(1); }

const index = args.find(a => a === '--index' || a.startsWith('--index='));
if (index) {
  const idx = await libraryIndex(nodeSource(dir), { publicOnly: args.includes('--public') });
  console.log(index === '--index=json' ? JSON.stringify(idx, null, 2) : indexMarkdown(idx));
  process.exit(0);
}

const report = await checkVault(nodeSource(dir));
console.log(formatReport(report, { verbose: process.argv.includes('--slides') }));
if (report.problems.length) process.exitCode = 1;
