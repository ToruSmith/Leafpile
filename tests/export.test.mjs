// 單一 HTML 匯出:模組收集與 HTML 組裝(不需要瀏覽器的部分)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectModules, buildHTML, formatSize } from '../app/player/export.js';

const appDir = fileURLToPath(new URL('../app/', import.meta.url));
const appBase = pathToFileURL(appDir).href;

test('collectModules:從 standalone.js 收集所有模組,相對 import 全部改寫', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    try { return { ok: true, text: async () => readFile(fileURLToPath(url), 'utf8') }; } catch { return { ok: false }; }
  };
  try {
    const mods = await collectModules(appBase);
    assert.ok(mods['@m/standalone.js']);
    assert.ok(mods['@m/player/player.js']);
    assert.ok(mods['@m/core/i18n.js']);
    assert.ok(!mods['@m/main.js'], '不應包含網站入口');
    for (const [k, src] of Object.entries(mods)) {
      assert.doesNotMatch(src, /^\s*(?:import|export)\b[^;'"]*?['"]\.{1,2}\//m, `${k} 還有相對 import`);
      for (const [, spec] of src.matchAll(/from\s*['"](@m\/[^'"]+)['"]/g)) assert.ok(spec in mods, `${k} 引用了沒收集到的 ${spec}`);
    }
    // 播放器程式必須原封不動(洗牌動畫與線上版相同)
    const orig = await readFile(new URL('../app/player/player.js', import.meta.url), 'utf8');
    const norm = s => s.replace(/(['"])(?:\.{1,2}\/|@m\/)[^'"]*\1/g, 'X');
    assert.equal(norm(mods['@m/player/player.js']), norm(orig));
  } finally { globalThis.fetch = realFetch; }
});

test('buildHTML:資料裡的 </script> 不會提早結束', () => {
  const html = buildHTML({
    deck: { title: '</script><script>alert(1)</script>', sections: [] },
    theme: 'ink', modules: { '@m/standalone.js': 'export {}' }, css: 'body{}</style><b>', media: {}, lang: 'en',
  });
  assert.equal(html.match(/<\/script>/g).length, 3); // 只有 importmap、data、入口三個
  assert.match(html, /<title>&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<\/style><b>/);
  assert.match(html, /data-theme="ink"/);
});

test('formatSize', () => {
  assert.equal(formatSize(2048), '2 KB');
  assert.equal(formatSize(3.5 * 1024 * 1024), '3.5 MB');
});
