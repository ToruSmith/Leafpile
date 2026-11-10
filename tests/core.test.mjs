import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../app/core/yaml.js';
import { renderMarkdown } from '../app/core/markdown.js';
import { parseSlideFile } from '../app/core/slide.js';
import { classifyMedia, resolveMediaPath } from '../app/core/media.js';
import { splitOrder } from '../app/core/names.js';
import { detectRootKind, scanLibrary, loadCover, loadDeck, flatten } from '../app/core/library.js';
import { memorySource } from './helpers.mjs';

test('yaml: 巢狀物件、物件清單、行內陣列、多行文字、註解', () => {
  const y = parseYaml(`
title: 標題 # 註解
date: 2026-11-20
count: 3
on: true
url: https://example.com/a#b
layout:
  stage: pile
  transition: shuffle
tags: [a, "b, c", 3]
sections:
  - folder: 01-問題
    color: "#b4654a"
  - folder: 02-方法
    hidden: true
list:
  - https://x.y/z
  - 純文字
desc: |
  第一行
  第二行
`);
  assert.equal(y.title, '標題');
  assert.equal(y.date, '2026-11-20');
  assert.equal(y.count, 3);
  assert.equal(y.on, true);
  assert.equal(y.url, 'https://example.com/a#b');
  assert.deepEqual(y.layout, { stage: 'pile', transition: 'shuffle' });
  assert.deepEqual(y.tags, ['a', 'b, c', 3]);
  assert.deepEqual(y.sections, [{ folder: '01-問題', color: '#b4654a' }, { folder: '02-方法', hidden: true }]);
  assert.deepEqual(y.list, ['https://x.y/z', '純文字']);
  assert.equal(y.desc, '第一行\n第二行');
});

test('yaml: 錯誤會帶行號', () => {
  assert.throws(() => parseYaml('a: 1\n\tb: 2'), /第 2 行/);
});

test('markdown: 區塊與行內語法,並跳脫 HTML', () => {
  const h = renderMarkdown('# 標題\n- 一 **粗**\n  - 二\n- [x] 完成\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\n<script>x</script>\n第一行\n第二行 ==亮==\n\n```js\nconst a = 1 < 2\n```');
  assert.match(h, /<h1>標題<\/h1>/);
  assert.match(h, /<ul><li>一 <strong>粗<\/strong><ul><li>二<\/li><\/ul><\/li><li class="task done">完成<\/li><\/ul>/);
  assert.match(h, /<td style="text-align:right">2<\/td>/);
  assert.match(h, /&lt;script&gt;/);
  assert.match(h, /第一行<br>第二行 <mark>亮<\/mark>/);
  assert.match(h, /<pre data-lang="js"><code><span class="tk-k">const<\/span> a = <span class="tk-n">1<\/span> &lt; <span class="tk-n">2<\/span><\/code><\/pre>/);
});

test('slide: front matter、--- 拆張、備註、媒體、自動版型', () => {
  const { slides, issues } = parseSlideFile(`---
step: true
---
# 第一張
- 甲

Note: 這是備註
第二行備註
---
![說明](media/a.jpg)
---
> 寫筆記是為了未來的自己
— 某人
---
<!-- layout: stats -->
- **3** 種
---
## 68%
示範數據
---
\`\`\`
---
\`\`\`
`, { path: 'd/01/a.md' });
  assert.equal(issues.length, 0);
  assert.equal(slides.length, 6);
  assert.equal(slides[0].title, '第一張');
  assert.equal(slides[0].meta.step, true);
  assert.equal(slides[0].notes, '這是備註\n第二行備註');
  assert.equal(slides[0].layout, 'text');
  assert.equal(slides[1].layout, 'full');
  assert.equal(slides[1].media[0].kind, 'image');
  assert.equal(slides[2].layout, 'quote');
  assert.equal(slides[3].layout, 'stats');
  assert.equal(slides[4].layout, 'number');
  assert.match(slides[5].body, /---/);
});

test('media: 線上嵌入與路徑規則', () => {
  assert.equal(classifyMedia('https://youtu.be/aqz-KE-bpKQ?t=30').provider, 'YouTube');
  assert.match(classifyMedia('https://www.youtube.com/watch?v=aqz-KE-bpKQ').embed, /embed\/aqz-KE-bpKQ/);
  assert.equal(classifyMedia('https://www.bilibili.com/video/BV1GJ411x7h7/').provider, 'Bilibili');
  assert.match(classifyMedia('https://drive.google.com/file/d/abc_123/view').embed, /abc_123\/preview/);
  assert.equal(classifyMedia('media/x.MP4').kind, 'video');
  const ctx = { projectPath: 't/p', filePath: 't/p/01-s/a.md' };
  assert.equal(resolveMediaPath('media/a.jpg', ctx), 't/p/media/a.jpg');
  assert.equal(resolveMediaPath('./a.jpg', ctx), 't/p/01-s/a.jpg');
  assert.equal(resolveMediaPath('../media/a.jpg', ctx), 't/p/media/a.jpg');
  assert.equal(resolveMediaPath('/media/a.jpg', ctx), 't/p/media/a.jpg');
});

test('names: 排序前綴', () => {
  assert.deepEqual(splitOrder('01-問題'), { order: 1, label: '問題' });
  assert.deepEqual(splitOrder('03_三種卡片.md'), { order: 3, label: '三種卡片' });
  assert.deepEqual(splitOrder('README'), { order: null, label: 'README' });
});

const LIB = {
  '_site.yml': 'title: 我的書架\ntopics: [工作]',
  '01-教學/_topic.yml': 'name: 教學\ncolor: "#123456"',
  '01-教學/2026-11-筆記/deck.yml': 'title: 筆記系統\ndate: 2026-11-20\nsections:\n  - folder: 02-方法\n    title: 方法論\n  - folder: 03-草稿\n    hidden: true\nend: 謝謝',
  '01-教學/2026-11-筆記/01-問題/01-a.md': '# A\n---\n# B',
  '01-教學/2026-11-筆記/01-問題/_draft.md': '# 草稿',
  '01-教學/2026-11-筆記/02-方法/01-c.md': '# C',
  '01-教學/2026-11-筆記/03-草稿/01-x.md': '# X',
  '01-教學/2026-11-筆記/media/a.jpg': 'bin',
  '01-教學/2025-01-舊/01-章/a.md': '# 舊簡報第一張',
  '02-工作/週報/a.md': '# 週報',
};

test('library: 根目錄類型偵測', async () => {
  assert.equal(await detectRootKind(memorySource(LIB)), 'library');
  assert.equal(await detectRootKind(memorySource({ 'deck.yml': 'title: x', '01/a.md': '#' })), 'deck');
  assert.equal(await detectRootKind(memorySource({ '01-s/a.md': '#', '02-s/b.md': '#' })), 'deck');
  assert.equal(await detectRootKind(memorySource({ 'a.md': '#' })), 'deck');
  assert.equal(await detectRootKind(memorySource({ 'p1/deck.yml': 'title: x', 'p1/a.md': '#' })), 'topic');
  assert.equal(await detectRootKind(memorySource({ 't/p/deck.yml': 'x: 1' })), 'library');
});

test('library: 第 1 層只讀設定檔,不讀任何 MD', async () => {
  const src = memorySource(LIB);
  const lib = await scanLibrary(src);
  assert.equal(lib.title, '我的書架');
  assert.deepEqual(lib.topics.map(t => t.title), ['工作', '教學']);
  assert.equal(lib.topics[1].color, '#123456');
  assert.deepEqual(lib.topics[1].projects.map(p => p.title), ['筆記系統', '舊']);
  assert.ok(src.reads.every(p => p.endsWith('.yml')), '目錄層只應讀 yml:' + src.reads.join(', '));
});

test('library: 第 2 層封面,有標題時不讀 MD', async () => {
  const src = memorySource(LIB);
  const lib = await scanLibrary(src);
  const [withConf, noConf] = lib.topics[1].projects;
  src.reads.length = 0;
  const c1 = await loadCover(src, withConf);
  assert.equal(c1.sections, 3);
  assert.equal(src.reads.length, 0);
  const c2 = await loadCover(src, noConf);
  assert.equal(c2.firstSlide.title, '舊簡報第一張');
  assert.equal(src.reads.length, 1);
});

test('library: 第 3 層整份簡報', async () => {
  const src = memorySource(LIB);
  const lib = await scanLibrary(src);
  const deck = await loadDeck(src, lib.topics[1].projects[0]);
  assert.deepEqual(deck.sections.map(s => s.title), ['問題', '方法論']);
  const flat = flatten(deck);
  assert.deepEqual(flat.map(s => s.layout), ['title', 'section', 'text', 'text', 'section', 'text', 'end']);
  assert.ok(!src.reads.some(p => p.includes('_draft') || p.includes('03-草稿')));
  assert.equal(deck.issues.length, 0);
});

test('library: 單一簡報資料夾(零設定)', async () => {
  const src = memorySource({ '01-開場/a.md': '# 你好', '02-結尾/b.md': '# 再見' }, '我的報告');
  const lib = await scanLibrary(src);
  assert.equal(lib.kind, 'deck');
  const deck = await loadDeck(src, lib.topics[0].projects[0]);
  assert.equal(deck.title, '我的報告');
  assert.deepEqual(flatten(deck).map(s => s.title), ['我的報告', '開場', '你好', '結尾', '再見']);
});

test('markdown:網址可含成對括號', () => {
  const h = renderMarkdown('[維基](https://en.wikipedia.org/wiki/Foo_(bar))');
  assert.match(h, /href="https:\/\/en\.wikipedia\.org\/wiki\/Foo_\(bar\)"/);
  assert.ok(!h.includes('</a>)'));
});

test('markdown:裸網址不做強調處理', () => {
  assert.equal(renderMarkdown('https://a.com/x__y__z'), '<p>https://a.com/x__y__z</p>');
});

test('markdown:連結內可以放圖片', () => {
  const h = renderMarkdown('[![x](a.png)](https://x.com)');
  assert.match(h, /<a href="https:\/\/x\.com"[^>]*><img data-media="a\.png" alt="x"><\/a>/);
});

test('markdown:__ 粗體要在字詞邊界,* 維持原樣', () => {
  assert.equal(renderMarkdown('snake__case__name'), '<p>snake__case__name</p>');
  assert.equal(renderMarkdown('__粗體__ 與 **粗體**'), '<p><strong>粗體</strong> 與 <strong>粗體</strong></p>');
});

test('markdown:XSS 回歸', () => {
  const cases = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '[a](javascript:alert(1))',
    '[a](JaVaScRiPt:alert(1))',
    '[a](  javascript:alert(1) )',
    '[a](data:text/html,<script>alert(1)</script>)',
    '[a](vbscript:msgbox(1))',
    '[a](" onmouseover="alert(1))',
    '![x](" onerror="alert(1))',
  ];
  for (const c of cases) {
    const h = renderMarkdown(c);
    assert.ok(!/<script|<img src|href="\s*(javascript|vbscript|data):|\son\w+="/i.test(h), `${c} → ${h}`);
  }
  assert.match(renderMarkdown('[a](JaVaScRiPt:alert(1))'), /^<p><a href="#"[^>]*>a<\/a><\/p>$/);
});

import { safeColor } from '../app/core/color.js';
import { renderSlide } from '../app/player/render.js';

test('safeColor:白名單', () => {
  for (const ok of ['#abc', '#a1b2c3', '#a1b2c3d4', 'red', 'Teal', 'rgb(1, 2, 3)', 'rgba(1,2,3,.5)', 'hsl(120deg 50% 40%)', 'hsl(120, 50%, 40%)']) assert.equal(safeColor(ok), ok, ok);
  for (const bad of ['red;background:url(//evil/x)', 'url(x)', 'expression(alert(1))', '#ggg', '#abcd', 'var(--x)', 'rgb(1,2,3);x:y', '', null, 'a'.repeat(30)]) assert.equal(safeColor(bad), null, String(bad));
});

test('顏色注入:投影片 color 不合法會被移除並回報', () => {
  const { slides, issues } = parseSlideFile('<!-- color: red;background:url(//evil/x) -->\n# x', { path: 'a.md' });
  assert.equal(slides[0].meta.color, undefined);
  assert.equal(issues.length, 1);
  const deck = { title: '', path: '', sections: [{ title: '', color: 'red;x:url(y)', slides: [] }] };
  const html = renderSlide({ layout: 'text', body: 'x', meta: { color: 'blue;background:url(//evil)' }, media: [], file: 'a', sec: 0, i: 0 }, { deck, mode: 'thumb', globalIndex: 0, total: 1 });
  assert.ok(!html.includes('url('), html.slice(0, 120));
});

test('顏色注入:設定檔裡的顏色不合法會回報並改用預設', async () => {
  const src = memorySource({
    '_site.yml': 'title: x',
    't/_topic.yml': 'color: "red;background:url(x)"',
    't/p/deck.yml': 'title: P\naccent: "url(x)"\nsections:\n  - folder: 01-a\n    color: "#zzz"',
    't/p/01-a/a.md': '# A',
  });
  const lib = await scanLibrary(src);
  assert.ok(!lib.topics[0].color.includes('url'));
  assert.equal(lib.topics[0].projects[0].accent, '');
  assert.equal(lib.issues.length, 2);
  const deck = await loadDeck(src, lib.topics[0].projects[0]);
  assert.match(deck.sections[0].color, /^#[0-9a-f]{6}$/i);
  assert.equal(deck.issues.length, 1);
});

import { highlight } from '../app/core/highlight.js';
import { undefinedFootnotes } from '../app/core/markdown.js';

test('腳註:依引用順序編號,定義放在最後,未定義顯示 ?', () => {
  const h = renderMarkdown('第二[^b] 第一[^a] 再一次[^b] 不存在[^x]\n\n[^a]: 甲來源\n[^b]: 乙來源');
  assert.match(h, /第二<sup class="fn">1<\/sup> 第一<sup class="fn">2<\/sup> 再一次<sup class="fn">1<\/sup> 不存在<sup class="fn missing">\?<\/sup>/);
  assert.match(h, /<div class="footnotes"><p class="source"><sup>1<\/sup> 乙來源<\/p><p class="source"><sup>2<\/sup> 甲來源<\/p><\/div>$/);
  assert.deepEqual(undefinedFootnotes('a[^1] b[^2] `c[^3]`\n[^1]: x'), ['2']);
  assert.deepEqual(undefinedFootnotes('```\n[^z]\n```'), []);
});

test('程式碼上色:關鍵字、字串、註解、數字;HTML 一律跳脫', () => {
  const h = highlight('const s = "<script>"; // 註解\nreturn 42', 'js');
  assert.match(h, /<span class="tk-k">const<\/span>/);
  assert.match(h, /<span class="tk-s">&quot;&lt;script&gt;&quot;<\/span>/);
  assert.match(h, /<span class="tk-c">\/\/ 註解<\/span>/);
  assert.match(h, /<span class="tk-n">42<\/span>/);
  assert.ok(!h.includes('<script'));
  for (const [lang, code, kw] of [['python', 'def f(): # x', 'def'], ['sql', 'SELECT * FROM t', 'SELECT'], ['bash', 'echo "hi"', 'echo'], ['json', '{"a": true}', 'true'], ['ts', 'interface A {}', 'interface']]) {
    assert.match(highlight(code, lang), new RegExp(`<span class="tk-k">${kw}</span>`), lang);
  }
  assert.equal(highlight('<b>', 'unknown'), '&lt;b&gt;');
  assert.match(renderMarkdown('```py\nx = 1 # <b>\n```'), /<pre data-lang="py"><code>x = <span class="tk-n">1<\/span> <span class="tk-c"># &lt;b&gt;<\/span><\/code><\/pre>/);
});

test('classifyMedia:互動網頁(GitHub Pages、CodePen、資料夾裡的 .html)', async () => {
  const { classifyMedia } = await import('../app/core/media.js');
  const gh = classifyMedia('https://someone.github.io/demo/');
  assert.equal(gh.kind, 'embed'); assert.equal(gh.provider, 'GitHub Pages'); assert.ok(gh.interactive);
  assert.equal(classifyMedia('https://someone.github.io/a/pic.png').kind, 'image', 'GitHub Pages 上的圖片仍是圖片');
  const cp = classifyMedia('https://codepen.io/jo/pen/AbCd12');
  assert.equal(cp.embed, 'https://codepen.io/jo/embed/AbCd12?default-tab=result&editable=false');
  assert.equal(classifyMedia('media/demo.html').kind, 'page');
  assert.equal(classifyMedia('https://example.com/demo.html').kind, 'image', '其他網站不嵌入');
});
