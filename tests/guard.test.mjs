// node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guard, frontMatter } from '../scripts/guard-content.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** 建一個暫時的書庫：files = { '相對路徑': 內容 } */
function lib(files) {
  const root = mkdtempSync(join(tmpdir(), 'leafpile-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
}

const PUBLIC_TOPIC = 'name: 範例\npublic: true\n';
const PRIVATE_TOPIC = 'name: 私人\npublic: false\n';

test('內建 content/ 沒有錯誤', () => {
  const res = guard(join(here, '..', 'content'), { today: '2026-11-09' });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.warnings, []);
});

test('front matter 解析(與網站同一個解析器)', () => {
  assert.deepEqual(frontMatter('---\ntitle: 甲\npublic: true\ntags: [a, b]\n---\n# 甲'), { title: '甲', public: true, tags: ['a', 'b'] });
});

test('互動網頁 .html 可以放,但影片仍然不行', () => {
  const root = lib({ 'slides/00-a/d/media/page.html': '<p>hi</p>', 'slides/00-a/d/media/a.webm': 'x' });
  const errs = guard(root).errors;
  assert.equal(errs.length, 1);
  assert.match(errs[0].file, /a\.webm$/);
});

test('私人主題底下沒寫 public 的筆記會被擋', () => {
  const root = lib({ 'notes/10-a/_topic.yml': PRIVATE_TOPIC, 'notes/10-a/x.md': '# x' });
  assert.equal(guard(root).errors.length, 1);
});

test('筆記明寫 public: true 可以覆蓋私人主題', () => {
  const root = lib({ 'notes/10-a/_topic.yml': PRIVATE_TOPIC, 'notes/10-a/x.md': '---\npublic: true\n---\n# x' });
  assert.deepEqual(guard(root).errors, []);
});

test('筆記本 _book.yml 的 public 介於筆記與主題之間', () => {
  const root = lib({
    'notes/10-a/_topic.yml': PRIVATE_TOPIC,
    'notes/10-a/book/_book.yml': 'public: true\n',
    'notes/10-a/book/01.md': '# 1',
    'notes/10-a/book/02.md': '---\npublic: false\n---\n# 2'
  });
  const errs = guard(root).errors.map(e => e.file);
  assert.deepEqual(errs, ['notes/10-a/book/02.md']);
});

test('local_only 主題不可放上 GitHub', () => {
  const root = lib({ 'notes/50-life/_topic.yml': 'public: true\nlocal_only: true\n', 'notes/50-life/x.md': '# x' });
  assert.match(guard(root).errors[0].msg, /local_only/);
});

test('中文路徑、影片與 PDF 會被擋', () => {
  const root = lib({ 'notes/00-a/_topic.yml': PUBLIC_TOPIC, 'notes/00-a/中文.md': '# x', 'slides/00-a/d/media/a.mp4': 'x', 'notes/00-a/b.pdf': 'x' });
  const msgs = guard(root).errors.map(e => e.msg).join('\n');
  assert.match(msgs, /路徑只能用/);
  assert.match(msgs, /\.mp4/);
  assert.match(msgs, /\.pdf/);
});

test('圖片大小上限可由 _site.yml 調整', () => {
  const big = 'x'.repeat(60 * 1024);
  const files = { 'slides/00-a/d/media/a.png': big };
  assert.deepEqual(guard(lib(files)).errors, []);
  const res = guard(lib({ ...files, '_site.yml': 'limits:\n  image_kb: 50\n' }));
  assert.match(res.errors[0].msg, /超過上限 50 KB/);
});

test('急件：沒有到期日、已過期都會警告', () => {
  const root = lib({
    'notes/00-a/_topic.yml': PUBLIC_TOPIC,
    'notes/00-a/a.md': '---\npinned: true\n---\n# a',
    'notes/00-a/b.md': '---\npinned: true\nexpires: 2026-01-01\n---\n# b'
  });
  const w = guard(root, { today: '2026-11-09' }).warnings.map(x => x.msg).join('\n');
  assert.match(w, /expires/);
  assert.match(w, /已在 2026-01-01 到期/);
});

test('個資只警告，程式碼區塊裡的不算', () => {
  const root = lib({
    'notes/00-a/_topic.yml': PUBLIC_TOPIC,
    'notes/00-a/a.md': '# a\n聯絡 someone@example.com\n```\nA123456789\n```'
  });
  const res = guard(root);
  assert.deepEqual(res.errors, []);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0].msg, /email/);
});
