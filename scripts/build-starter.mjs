#!/usr/bin/env node
// 組出「範例書庫」:給使用者下載後放在自己電腦裡的 Leafpile 書庫起手式。
//   starter/ 的說明與設定 + dist/ 的檢查工具 + content/ 的預設主題(只有設定檔,不含官方範例)
//   + 一篇歡迎筆記 + _docs/(規格與指南,離線也能看、AI 也讀得到)
//
//   node scripts/build-starter.mjs <輸出資料夾>

import { cp, mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/build-starter.mjs <out-dir>'); process.exit(1); }
const REPO = 'https://github.com/ToruSmith/Leafpile/blob/main/';
const SKIP_TOPIC = /^00-/; // 官方範例留在網站上

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const dir of ['starter', 'dist']) await cp(dir, out, { recursive: true });

// 預設主題:只帶 _topic.yml(名稱、分類、顏色、公開與否),內容由使用者自己放
for (const channel of ['notes', 'slides']) {
  for (const name of await readdir(join('content', channel))) {
    if (SKIP_TOPIC.test(name)) continue;
    const conf = join('content', channel, name, '_topic.yml');
    if (!(await stat(conf).catch(() => null))) continue;
    await mkdir(join(out, channel, name), { recursive: true });
    await cp(conf, join(out, channel, name, '_topic.yml'));
  }
}
await mkdir(join(out, 'boards'), { recursive: true });
await writeFile(join(out, 'boards', '.gitkeep'), '');

// 說明文件放在 _docs/(底線開頭不會被當成筆記或簡報)。連到倉庫其他檔案的連結改成 GitHub 網址。
const DOCS = ['docs/SPEC.md', 'docs/INTEROP.md', 'docs/AI_PROMPTS.md', 'docs/slides/GUIDE.zh-Hant.md', 'docs/slides/GUIDE.en.md', 'docs/slides/MANUAL.zh-Hant.md', 'docs/slides/MANUAL.en.md'];
for (const from of DOCS) {
  const to = join(out, '_docs', from.slice('docs/'.length));
  const depth = from.split('/').length - 2; // docs/ 底下第幾層
  const text = (await readFile(from, 'utf8')).replace(/\]\(((?:\.\.\/)+)([^)#\s]+)(#[^)]*)?\)/g, (m, ups, path, hash = '') => {
    const n = ups.length / 3;
    if (n <= depth) return m; // 還在 docs/ 裡面
    return `](${REPO}${path}${hash})`;
  }).replace(/\]\(images\//g, `](${REPO.replace('/blob/', '/raw/')}docs/images/`).replace(/\]\(\.\.\/images\//g, `](${REPO.replace('/blob/', '/raw/')}docs/images/`);
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, text);
}
console.log(out);
