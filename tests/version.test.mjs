// 版本號三處一致:package.json、app/main.js、CHANGELOG.md 最新標題
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = p => readFile(new URL('../' + p, import.meta.url), 'utf8');

test('版本號一致', async () => {
  const pkg = JSON.parse(await read('package.json')).version;
  const main = (await read('app/main.js')).match(/export const VERSION = '([^']+)'/)[1];
  const log = (await read('CHANGELOG.md')).match(/^## (\d+\.\d+\.\d+)/m)[1];
  assert.equal(main, pkg, 'app/main.js 與 package.json 不一致');
  assert.equal(log, pkg, 'CHANGELOG.md 最新版本與 package.json 不一致');
});
