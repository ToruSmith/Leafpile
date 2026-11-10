// 網站本身:離線快取清單、CSP、manifest。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { shellFiles, shellManifest } from '../scripts/shell-files.mjs';
import { classifyMedia } from '../app/core/media.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = p => readFile(new URL('../' + p, import.meta.url), 'utf8');

test('離線快取清單:包含入口與所有程式,不包含簡報內容', async () => {
  const files = (await shellFiles(root)).map(f => f.path);
  for (const p of ['index.html', 'offline.html', 'manifest.webmanifest', 'icon.svg', 'app/main.js', 'app/standalone.js', 'app/styles/app.css']) assert.ok(files.includes(p), p);
  assert.ok(!files.some(p => p.startsWith('content/') || p === 'catalog.json'));
  for (const p of files) await access(new URL('../' + p, import.meta.url));
  const html = await read('index.html');
  for (const [, href] of html.matchAll(/(?:href|src)="([^":]+)"/g)) assert.ok(files.includes(href), `index.html 引用的 ${href} 不在快取清單`);
});

test('快取版本:內容變了,版本就變', () => {
  const a = shellManifest([{ path: 'a.js', hash: '1' }]);
  const b = shellManifest([{ path: 'a.js', hash: '2' }]);
  const v = s => s.match(/"version": "(\w+)"/)[1];
  assert.notEqual(v(a), v(b));
  assert.match(a, /"\.\/"/);
});

test('CSP:允許四個嵌入網域,其他框架與行內程式一律擋下', async () => {
  const html = await read('index.html');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const dir = name => csp.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' '))?.split(/\s+/).slice(1) || [];
  assert.deepEqual(dir('script-src'), ["'self'"]);
  const frames = dir('frame-src');
  for (const url of ['https://youtu.be/aqz-KE-bpKQ', 'https://www.bilibili.com/video/BV1xx411c7mD', 'https://drive.google.com/file/d/abc123/view', 'https://vimeo.com/76979871', 'https://codepen.io/jo/pen/AbCd12']) {
    const m = classifyMedia(url);
    assert.ok(m.embed, url);
    assert.ok(frames.includes(new URL(m.embed).origin), `${new URL(m.embed).origin} 不在 frame-src`);
  }
  assert.ok(frames.includes('https://*.github.io') && frames.includes("'self'"), 'GitHub Pages 與倉庫裡的 HTML 要能嵌入');
  assert.ok(!frames.includes('https:') && !frames.includes('*'), '不開放任意網站');
  assert.ok(!/\son[a-z]+=/i.test(html), 'index.html 不能有行內事件');
});

test('manifest.webmanifest 格式正確', async () => {
  const m = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(m.start_url, './');
  assert.ok(m.name);
  // Chrome 安裝需要 192 與 512 的 PNG;iPhone 主畫面需要 apple-touch-icon(PNG)
  for (const size of ['192x192', '512x512']) assert.ok(m.icons.some(i => i.sizes === size && i.type === 'image/png'), size);
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  for (const i of m.icons) await access(new URL('../' + i.src, import.meta.url));
  assert.match(await read('index.html'), /rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/);
});
