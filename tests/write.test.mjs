// 寫入的安全規則:路徑與副檔名限制、權限、檔案被別的程式改過時要停下來、封存不刪檔。
// 用假的 FileSystemDirectoryHandle 在 Node 裡測(瀏覽器的實作行為相同)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandleSource } from '../app/sources/sources.js';

function fakeDir(name = 'lib', files = {}, dirs = {}) {
  const d = {
    kind: 'directory', name, files, dirs,
    async *entries() {
      for (const n of Object.keys(files)) yield [n, { kind: 'file', getFile: async () => fileOf(files[n]) }];
      for (const n of Object.keys(dirs)) yield [n, dirs[n]];
    },
    async getDirectoryHandle(n, o) {
      if (!dirs[n]) { if (!o?.create) throw new Error('not found'); dirs[n] = fakeDir(n); }
      return dirs[n];
    },
    async getFileHandle(n, o) {
      if (files[n] === undefined && !o?.create) throw new Error('not found');
      return {
        kind: 'file',
        getFile: async () => fileOf(files[n] ?? ''),
        createWritable: async () => ({ write: t => { d.pending = t; }, close: async () => { files[n] = d.pending; } }),
      };
    },
    async removeEntry(n) { delete files[n]; },
    queryPermission: async () => d.perm || 'prompt',
    requestPermission: async () => (d.perm = d.grant ?? 'granted'),
  };
  return d;
}
const fileOf = text => ({ text: async () => text, lastModified: text.length * 10, size: text.length });

test('writeText:只能寫 .md / .yml,路徑不能跳出資料夾', async () => {
  const root = fakeDir('lib', { 'a.md': '# a' });
  const s = new HandleSource(root);
  for (const bad of ['../x.md', 'a/../../x.md', '/abs.md', 'evil.html', 'evil.js', 'a//b.md']) {
    await assert.rejects(() => s.writeText(bad, 'x'), /bad (path|type)/, bad);
  }
  assert.deepEqual(Object.keys(root.files), ['a.md'], '不該新增任何檔案');
});

test('writeText:沒有授權就不寫', async () => {
  const root = fakeDir('lib', { 'a.md': '# a' });
  root.grant = 'denied';
  const s = new HandleSource(root);
  await assert.rejects(() => s.writeText('a.md', 'changed'), /denied/);
  assert.equal(root.files['a.md'], '# a', '原檔不能動');
});

test('writeText:檔案被別的程式改過就停下來', async () => {
  const root = fakeDir('lib', { 'a.md': '# a' });
  const s = new HandleSource(root);
  const before = await s.stat('a.md');
  root.files['a.md'] = '# 別人改過了';
  await assert.rejects(() => s.writeText('a.md', '我的版本', { expect: before }), /stale/);
  assert.equal(root.files['a.md'], '# 別人改過了', '不能蓋掉別人的修改');
  // 重新取得狀態後就能寫
  const now = await s.stat('a.md');
  const after = await s.writeText('a.md', '我的版本', { expect: now });
  assert.equal(root.files['a.md'], '我的版本');
  assert.equal(after, await s.stat('a.md'));
});

test('archive:搬到 _封存,不真的刪掉;同名會加編號', async () => {
  const root = fakeDir('lib', {}, { deck: fakeDir('deck', {}, { '01-sec': fakeDir('01-sec', { '01-x.md': 'one', '02-x.md': 'two' }) }) });
  const s = new HandleSource(root);
  const to = await s.archive('deck/01-sec/01-x.md', 'deck/_封存');
  assert.equal(to, 'deck/_封存/01-x.md');
  assert.equal(root.dirs.deck.dirs['_封存'].files['01-x.md'], 'one', '內容要保留');
  assert.ok(!('01-x.md' in root.dirs.deck.dirs['01-sec'].files), '原位置移除');
  // 另一個同名檔案不會覆蓋前一個
  root.dirs.deck.dirs['01-sec'].files['01-x.md'] = 'again';
  assert.equal(await s.archive('deck/01-sec/01-x.md', 'deck/_封存'), 'deck/_封存/01-x-2.md');
  assert.equal(root.dirs.deck.dirs['_封存'].files['01-x.md'], 'one', '先前封存的不能被蓋掉');
});
