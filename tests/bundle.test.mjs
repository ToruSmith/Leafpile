// 單檔版 dist/leafpile-check.mjs 必須與 app/core 同步,而且可以獨立執行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { bundle } from '../scripts/bundle-check.mjs';

const dist = new URL('../dist/leafpile-check.mjs', import.meta.url);

test('dist/leafpile-check.mjs 與原始碼同步(不同步請執行 node scripts/bundle-check.mjs)', async () => {
  assert.equal(await readFile(dist, 'utf8'), await bundle());
});

test('單檔版可以獨立檢查內建書庫', () => {
  const out = execFileSync(process.execPath, [dist.pathname, new URL('../content', import.meta.url).pathname, '--lang', 'zh-Hant'], { encoding: 'utf8' });
  assert.match(out, /✓ 沒有發現問題/);
});
