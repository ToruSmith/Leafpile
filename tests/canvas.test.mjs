// 畫布(JSON Canvas)的純邏輯。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memorySource } from './helpers.mjs';
import { nodeSource } from '../scripts/node-source.mjs';
import { openVault } from '../app/core/vault.js';
import { buildGraph } from '../app/core/graph.js';
import { checkVault } from '../app/core/check.js';
import { parseCanvas, serializeCanvas, canvasColor, anchor, edgePath, bounds, resolveFile, missingFiles, newId, boardFileName } from '../app/core/canvas.js';

test('parseCanvas / serializeCanvas:保留不認得的欄位;壞掉的項目略過但不讓整張壞掉', () => {
  const src = JSON.stringify({
    'x-board': { zoom: 1 }, nodes: [
      { id: 'g', type: 'group', label: 'G', x: 0, y: 0, width: 500, height: 300, 'x-foo': 1 },
      { id: 'a', type: 'text', text: 'hi', x: 10.4, y: 20, width: 200, height: 80, color: '3', obsidianThing: true },
      { id: 'a', type: 'text', text: 'dup', x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', type: 'nope' },
      { id: 'c', type: 'file', file: 'notes/x.md', x: 300, y: 0 },
    ],
    edges: [{ id: 'e1', fromNode: 'a', toNode: 'c', label: 'L', 'x-kind': 'promote' }, { id: 'e2', fromNode: 'a', toNode: 'zz' }],
  });
  const b = parseCanvas(src);
  assert.deepEqual(b.nodes.map(n => n.id), ['g', 'a', 'c']);
  assert.equal(b.issues.length, 3);
  assert.equal(b.nodes[2].width, 260); // 缺尺寸:用預設
  const out = JSON.parse(serializeCanvas(b));
  assert.deepEqual(out['x-board'], { zoom: 1 });
  assert.equal(out.nodes[0]['x-foo'], 1);
  assert.equal(out.nodes[1].obsidianThing, true);
  assert.equal(out.nodes[1].x, 10);
  assert.deepEqual(out.edges, [{ id: 'e1', fromNode: 'a', toNode: 'c', label: 'L', 'x-kind': 'promote' }]);
  assert.throws(() => parseCanvas('{壞'), /JSON/);
  assert.deepEqual(parseCanvas('').nodes, []);
});

test('canvasColor:只接受預設色 1–6 與 #hex', () => {
  assert.equal(canvasColor('1'), '#c0504d');
  assert.equal(canvasColor('#abc'), '#abc');
  assert.equal(canvasColor('red; background:url(x)'), '');
  assert.equal(canvasColor(undefined), '');
});

test('anchor / edgePath / bounds:幾何', () => {
  const a = { x: 0, y: 0, width: 100, height: 50 }, b = { x: 300, y: 0, width: 100, height: 50 };
  assert.deepEqual(anchor(a, undefined, b), { x: 100, y: 25, side: 'right' });
  assert.deepEqual(anchor(b, undefined, a), { x: 300, y: 25, side: 'left' });
  assert.deepEqual(anchor(a, 'bottom'), { x: 50, y: 50, side: 'bottom' });
  const p = edgePath(a, b);
  assert.match(p.d, /^M 100 25 C /);
  assert.deepEqual(p.mid, { x: 200, y: 25 });
  assert.deepEqual(bounds([a, b]), { x: 0, y: 0, width: 400, height: 50 });
  assert.equal(bounds([]), null);
});

test('resolveFile / missingFiles:筆記、簡報(deck.yml 或資料夾)、找不到', async () => {
  const g = await buildGraph(await openVault(memorySource({
    'notes/10-reading/a.md': '# A',
    'slides/10-reading/talk/deck.yml': 'title: 分享\n', 'slides/10-reading/talk/01.md': '# 1',
  })));
  assert.equal(resolveFile('notes/10-reading/a.md', g).kind, 'note');
  assert.equal(resolveFile('slides/10-reading/talk/deck.yml', g).rec.title, '分享');
  assert.equal(resolveFile('slides/10-reading/talk', g).kind, 'deck');
  assert.equal(resolveFile('notes/nope.md', g).kind, 'missing');
  const board = parseCanvas(JSON.stringify({ nodes: [{ id: 'x', type: 'file', file: 'notes/nope.md', x: 0, y: 0, width: 10, height: 10 }, { id: 'y', type: 'file', file: 'notes/10-reading/a.md', x: 0, y: 0, width: 10, height: 10 }] }));
  assert.deepEqual(missingFiles(board, g), ['notes/nope.md']);
  assert.notEqual(newId(board), newId({ nodes: [], edges: [] }) + 'x');
  assert.equal(boardFileName(' 讀書 / 規劃?'), '讀書-規劃.canvas');
});

test('檢查工具:畫布壞掉是錯誤,卡片指到不存在的檔案是提醒;範例畫布沒有問題', async () => {
  const lib = { 'notes/a.md': '# A', 'boards/ok.canvas': JSON.stringify({ nodes: [{ id: 'x', type: 'file', file: 'notes/gone.md', x: 0, y: 0, width: 10, height: 10 }], edges: [] }), 'boards/bad.canvas': '{' };
  const r = await checkVault(memorySource(lib));
  assert.ok(r.problems.some(p => p.path === 'boards/bad.canvas'));
  assert.ok(r.warnings.some(w => w.path === 'boards/ok.canvas' && w.message.includes('notes/gone.md')));
  const content = await checkVault(nodeSource(new URL('../content', import.meta.url).pathname));
  assert.deepEqual([...content.problems, ...content.warnings].filter(x => x.path.startsWith('boards/')), []);
  assert.ok(parseCanvas(readFileSync(new URL('../content/boards/00-examples-overview.canvas', import.meta.url), 'utf8')).nodes.length > 3);
});

import { fileKind, extractURL, embedFor, slideOrder, textToNote, boardsWith, pdfPage } from '../app/core/canvas.js';
import { classifyMedia, startSeconds } from '../app/core/media.js';

test('fileKind / extractURL', () => {
  assert.deepEqual(['boards/media/a.WEBP', 'x/p.html', 'x/d.pdf', 'notes/a.md', 'slides/t/x/deck.yml', 'a.zip'].map(fileKind), ['image', 'html', 'pdf', 'note', 'deck', 'other']);
  assert.equal(extractURL('<iframe src="https://docs.google.com/presentation/d/e/2PAC/embed?start=false&amp;loop=false" width="960"></iframe>'), 'https://docs.google.com/presentation/d/e/2PAC/embed?start=false&loop=false');
  assert.equal(extractURL('  https://a.b/c '), 'https://a.b/c');
});

test('embedFor:播放器與 Google 簡報自動嵌入;一般網頁要 x-embed;只收 https', () => {
  assert.equal(embedFor({ url: 'https://youtu.be/dQw4w9WgXcQ' }, classifyMedia).provider, 'YouTube');
  assert.match(embedFor({ url: 'https://docs.google.com/presentation/d/1AbC_d-9/edit#slide=id.p' }, classifyMedia).url, /^https:\/\/docs\.google\.com\/presentation\/d\/1AbC_d-9\/embed\?/);
  assert.match(embedFor({ url: 'https://docs.google.com/presentation/d/e/2PACX-1v/pub?start=false' }, classifyMedia).url, /\/d\/e\/2PACX-1v\/embed/);
  assert.equal(embedFor({ url: 'https://example.org/page' }, classifyMedia), null);
  assert.deepEqual(embedFor({ url: 'https://example.org/page', 'x-embed': true }, classifyMedia), { url: 'https://example.org/page', provider: 'example.org', auto: false });
  assert.equal(embedFor({ url: 'http://example.org/page', 'x-embed': true }, classifyMedia), null);
  assert.equal(embedFor({ url: 'javascript:alert(1)', 'x-embed': true }, classifyMedia), null);
});

test('slideOrder:群組優先;由上到下、同列由左到右', () => {
  const n = (id, x, y, type = 'text') => ({ id, type, x, y, width: 100, height: 100 });
  assert.deepEqual(slideOrder({ nodes: [n('c', 0, 300), n('b', 200, 10), n('a', 0, 0)] }).map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual(slideOrder({ nodes: [n('t', 0, 0), n('g2', 500, 0, 'group'), n('g1', 0, 0, 'group')] }).map(x => x.id), ['g1', 'g2']);
});

test('textToNote / boardsWith', () => {
  assert.deepEqual(textToNote('\n# 本月目標\n讀完兩本書\n'), { title: '本月目標', body: '讀完兩本書' });
  assert.deepEqual(textToNote('一句話就是**標題**\n第二行'), { title: '一句話就是標題', body: '一句話就是**標題**\n第二行' });
  assert.deepEqual(textToNote('  '), { title: '', body: '' });
  const boards = [{ name: 'A', board: { nodes: [{ type: 'file', file: 'notes/x.md' }] } }, { name: 'B', board: { nodes: [{ type: 'text', text: 'notes/x.md' }] } }];
  assert.deepEqual(boardsWith(boards, 'notes/x.md'), ['A']);
});

test('影片開始時間:t=90、90s、1m30s、1h2m3s、start=;嵌入網址帶上秒數', () => {
  assert.equal(startSeconds('https://youtu.be/dQw4w9WgXcQ?t=90'), 90);
  assert.equal(startSeconds('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s'), 90);
  assert.equal(startSeconds('https://youtu.be/x?t=1h2m3s'), 3723);
  assert.equal(startSeconds('https://vimeo.com/123#t=45s'), 45);
  assert.equal(startSeconds('https://youtu.be/x'), 0);
  assert.equal(startSeconds('https://youtu.be/x?t=abc'), 0);
  assert.match(classifyMedia('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s').embed, /&start=90$/);
  assert.match(classifyMedia('https://vimeo.com/76979871#t=45s').embed, /\/76979871#t=45s$/);
  assert.match(classifyMedia('https://www.bilibili.com/video/BV1xx411c7mD?t=30').embed, /&t=30$/);
  assert.doesNotMatch(classifyMedia('https://vimeo.com/76979871').embed, /#t=/);
});

test('PDF 卡的頁碼:subpath "#page=N"(和 Obsidian 相同),其他寫法一律當沒有;存檔保留欄位', () => {
  assert.equal(pdfPage({ subpath: '#page=3' }), 3);
  for (const s of [undefined, '', '#page=0', '#page=x', '#heading', 'page=3', '#page=3; x']) assert.equal(pdfPage({ subpath: s }), 0, String(s));
  const b = parseCanvas('{"nodes":[{"id":"p","type":"file","file":"a.pdf","subpath":"#page=7","x":0,"y":0,"width":100,"height":100}],"edges":[]}');
  assert.match(serializeCanvas(b), /"subpath": "#page=7"/);
});

import { boardRefs, otherBoards, foldNode, unfoldNode, isFolded, fitHeight, FOLDED_HEIGHT } from '../app/core/canvas.js';

test('boardRefs / otherBoards:每個檔案在哪些畫布(不重複、/ 開頭也算同一個)', () => {
  const boards = [
    { name: 'A', board: { nodes: [{ type: 'file', file: 'notes/x.md' }, { type: 'file', file: '/notes/x.md' }, { type: 'text', text: 'notes/y.md' }] } },
    { name: 'B', board: { nodes: [{ type: 'file', file: 'notes/x.md' }, { type: 'file', file: 'notes/y.md' }] } },
    { name: 'C', board: { nodes: [] } },
  ];
  const refs = boardRefs(boards);
  assert.deepEqual(refs.get('notes/x.md'), ['A', 'B']);
  assert.deepEqual(refs.get('notes/y.md'), ['B']);
  assert.deepEqual(otherBoards(refs, '/notes/x.md', 'A'), ['B']);
  assert.deepEqual(otherBoards(refs, 'notes/z.md', 'A'), []);
  assert.deepEqual(otherBoards(null, 'notes/x.md', 'A'), []);
});

test('摺疊與展開:記住原本高度;只有文字卡與筆記卡能摺', () => {
  const n = { id: 'a', type: 'file', file: 'notes/x.md', height: 320 };
  assert.equal(foldNode(n), true);
  assert.equal(isFolded(n), true);
  assert.equal(n.height, FOLDED_HEIGHT);
  assert.equal(n['x-leafpile-height'], 320);
  assert.equal(foldNode(n), false, '已經摺了');
  assert.equal(unfoldNode(n), true);
  assert.deepEqual(n, { id: 'a', type: 'file', file: 'notes/x.md', height: 320 }, '展開後不留 x- 欄位');
  assert.equal(unfoldNode(n), false);
  assert.equal(foldNode({ type: 'file', file: 'boards/media/a.png', height: 100 }), false);
  assert.equal(foldNode({ type: 'group', height: 100 }), false);
  const t2 = { type: 'text', text: 'x', height: 90, 'x-leafpile-folded': true };
  unfoldNode(t2);
  assert.equal(t2.height, 240, '沒有記錄原本高度時用預設值');
  // 存檔再讀回來,摺疊狀態還在(x- 欄位原樣保留)
  const b = parseCanvas(serializeCanvas({ nodes: [{ id: 'a', type: 'text', text: 'x', x: 0, y: 0, width: 200, height: 320 }], edges: [], extra: {} }));
  foldNode(b.nodes[0]);
  const back = parseCanvas(serializeCanvas(b));
  assert.equal(isFolded(back.nodes[0]), true);
  assert.equal(back.nodes[0]['x-leafpile-height'], 320);
});

test('fitHeight:取整數、有上下限', () => {
  assert.equal(fitHeight(123.2), 124);
  assert.equal(fitHeight(10), 60);
  assert.equal(fitHeight(99999), 2400);
  assert.equal(fitHeight(NaN), 60);
});

import { placeFileNode } from '../app/core/canvas.js';

test('placeFileNode:放在現有卡片右邊;空畫布放原點;已經在畫布上就不放', () => {
  const b = { nodes: [{ id: 'a', type: 'text', x: 10, y: 20, width: 100, height: 50 }, { id: 'b', type: 'text', x: 0, y: 200, width: 300, height: 50 }], edges: [] };
  const n = placeFileNode(b, '/notes/Ab.md');
  assert.equal(n.file, 'notes/Ab.md', '保留大小寫,去掉開頭的 /');
  assert.deepEqual([n.x, n.y, n.width, n.height], [360, 20, 340, 300]);
  assert.equal(b.nodes.length, 3);
  assert.equal(placeFileNode(b, 'notes/ab.md'), null, '比對時不分大小寫(和 boardRefs 相同)');
  const empty = { nodes: [], edges: [] };
  const m = placeFileNode(empty, 'notes/y.md');
  assert.deepEqual([m.x, m.y], [0, 0]);
});
