import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefixProblems, checkLibrary } from '../app/core/check.js';
import { setLang } from '../app/core/i18n.js';
import { memorySource } from './helpers.mjs';

setLang('en');

test('prefixProblems:重複的數字前綴', () => {
  const r = prefixProblems(['01-a.md', '1-b.md', '02-c.md']);
  assert.equal(r.filter(p => p.kind === 'dup').length, 1);
  assert.deepEqual(r.find(p => p.kind === 'dup').names, ['01-a.md', '1-b.md']);
  assert.equal(r.filter(p => p.kind === 'width').length, 0, '重複的那組不要再報一次位數混用');
});

test('prefixProblems:位數混用', () => {
  const r = prefixProblems(['10-b.md', '2-a.md', '3-c.md']);
  assert.deepEqual(r, [{ kind: 'width', names: ['2-a.md', '10-b.md'] }]);
});

test('prefixProblems:統一位數、日期前綴、沒有前綴都不警告', () => {
  assert.deepEqual(prefixProblems(['01-a.md', '02-b.md', '10-c.md']), []);
  assert.deepEqual(prefixProblems(['2026-11-讀書會', '2026-12-年終', '01-a']), []);
  assert.deepEqual(prefixProblems(['a.md', 'b.md']), []);
});

test('檢查:前綴問題與空白投影片', async () => {
  const src = memorySource({
    '01-a.md': '# A',
    '1-b.md': '# B\n\n---\n\n<!-- layout: center -->\n',
    '02-章節/1-x.md': '# X',
    '02-章節/10-y.md': '# Y',
    '03-章節/01-z.md': '---\nlayout: text\n---\n',
  });
  const r = await checkLibrary(src);
  const msgs = r.problems.map(p => `${p.path}: ${p.message}`);
  assert.ok(msgs.some(m => /prefix 01/.test(m) && m.includes('1-b.md')), msgs.join('\n'));
  assert.ok(msgs.some(m => m.startsWith('02-章節:') && /different widths/.test(m)), msgs.join('\n'));
  assert.ok(msgs.some(m => m.startsWith('1-b.md:') && /Slide 2 is empty/.test(m)), msgs.join('\n'));
  assert.ok(msgs.some(m => m.startsWith('03-章節/01-z.md:') && /Slide 1 is empty/.test(m)), msgs.join('\n'));
  // 自動產生的標題頁、章節頁不算空白
  assert.equal(msgs.filter(m => /is empty/.test(m)).length, 2, msgs.join('\n'));
});
