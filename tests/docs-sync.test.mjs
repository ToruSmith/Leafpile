// 防止規則文件與程式不同步:每個版型、主題、排列都必須寫在 製作專案指南.md 裡。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LAYOUTS } from '../app/core/slide.js';

const guide = await readFile(new URL('../docs/slides/GUIDE.zh-Hant.md', import.meta.url), 'utf8');
const guideEn = await readFile(new URL('../docs/slides/GUIDE.en.md', import.meta.url), 'utf8');
const manual = await readFile(new URL('../docs/slides/MANUAL.zh-Hant.md', import.meta.url), 'utf8');
const manualEn = await readFile(new URL('../docs/slides/MANUAL.en.md', import.meta.url), 'utf8');
const css = await readFile(new URL('../app/styles/slides.css', import.meta.url), 'utf8');
const themes = await readFile(new URL('../app/player/themes.js', import.meta.url), 'utf8');
const layouts = await readFile(new URL('../app/player/layouts.js', import.meta.url), 'utf8');

test('每個版型都寫在指南裡,也有對應樣式(text 用預設樣式)', () => {
  for (const l of LAYOUTS.filter(x => x !== 'auto')) {
    assert.ok(guide.includes('`' + l + '`'), `製作專案指南.md 缺少版型 ${l}`);
    assert.ok(guideEn.includes('`' + l + '`'), `docs/GUIDE.en.md 缺少版型 ${l}`);
    if (l !== 'text') assert.ok(css.includes(`.l-${l}`), `slides.css 缺少 .l-${l}`);
  }
});

test('每個主題與 3D 排列都寫在指南裡', () => {
  for (const t of themes.match(/THEMES = \[(.*?)\]/)[1].match(/'(\w+)'/g).map(s => s.slice(1, -1))) { assert.ok(guide.includes(t), `指南缺少主題 ${t}`); assert.ok(guideEn.includes(t), `英文指南缺少主題 ${t}`); }
  for (const s of [...layouts.matchAll(/^\s{2}(\w+): \{ fn:/gm)].map(m => m[1])) { assert.ok(guide.includes(s), `指南缺少排列 ${s}`); assert.ok(guideEn.includes(s), `英文指南缺少排列 ${s}`); }
});

test('使用手冊的版型一覽與設定速查表沒有漏掉', () => {
  for (const l of LAYOUTS.filter(x => !['auto', 'title', 'section'].includes(x))) {
    assert.ok(manual.includes('`' + l + '`'), `docs/使用手冊.md 缺少版型 ${l}`);
    assert.ok(manualEn.includes('`' + l + '`'), `docs/MANUAL.en.md 缺少版型 ${l}`);
  }
  for (const key of ['layout', 'step', 'ratio', 'align', 'fit', 'size', 'color', 'text', 'font', 'background', 'overlay', 'footer', 'hidden', 'title', 'mark', 'chart', 'unit']) {
    assert.ok(manual.includes(`<!-- ${key}:`), `使用手冊的設定速查表缺少 ${key}`);
    assert.ok(manualEn.includes(`<!-- ${key}:`), `MANUAL.en.md 的設定速查表缺少 ${key}`);
  }
});
