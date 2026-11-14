// 空資料夾的起手式:檔案清單要合規(只有 .md/.yml、路徑在書庫內),而且寫完後 openVault 認得出來。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaffoldFiles } from '../app/core/scaffold.js';
import { openVault } from '../app/core/vault.js';
import { parseYaml } from '../app/core/yaml.js';
import { setLang } from '../app/core/i18n.js';

const memorySource = files => ({
  kind: 'memory', label: 'x',
  async list(path) {
    const prefix = path ? path + '/' : '';
    const seen = new Map();
    for (const f of Object.keys(files)) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length), i = rest.indexOf('/');
      seen.set(i < 0 ? rest : rest.slice(0, i), i < 0 ? 'file' : 'dir');
    }
    return [...seen].map(([name, kind]) => ({ name, kind }));
  },
  async readText(path) { if (path in files) return files[path]; throw new Error('nf'); },
  mediaURL: p => p, releaseMedia() {},
});

for (const lang of ['zh-Hant', 'en']) {
  test(`scaffoldFiles(${lang}):路徑合規、YAML 能解析`, () => {
    setLang(lang);
    for (const kind of ['empty', 'sample']) {
      const files = scaffoldFiles(kind);
      assert.ok(files.length >= 3);
      for (const f of files) {
        assert.match(f.path, /\.(md|yml)$/);
        assert.ok(!f.path.startsWith('/') && !f.path.includes('..'), f.path);
        if (f.path.endsWith('.yml')) assert.doesNotThrow(() => parseYaml(f.text), f.path);
      }
      assert.equal(files.some(f => f.path.endsWith('welcome.md')), kind === 'sample');
    }
  });
}

test('scaffoldFiles:標題可自訂,特殊字元被加引號', () => {
  setLang('zh-Hant');
  const site = scaffoldFiles('empty', { title: 'a: b # c' }).find(f => f.path === '_site.yml');
  assert.equal(parseYaml(site.text).title, 'a: b # c');
});

test('寫完之後 openVault 認得出是 Leafpile 書庫,而且有收件匣主題', async () => {
  setLang('zh-Hant');
  const files = Object.fromEntries(scaffoldFiles('sample').map(f => [f.path, f.text]));
  const vault = await openVault(memorySource(files));
  assert.equal(vault.kind, 'leafpile');
  assert.ok(vault.topics.some(tp => tp.id === '01-inbox'));
  const inbox = vault.topics.find(tp => tp.id === '01-inbox');
  assert.equal(inbox.notes.items.length, 1);
});
