// 畫布編輯工具的純函式。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membersOf, withMembers, alignNodes, distribute, snapLines, snapMove, copyFragment, parseFragment, pasteFragment, searchNodes, groupOutline, buildBoardSvg, wrapText, strokesToSvg } from '../app/core/canvas-ops.js';

const N = (id, x, y, w = 100, h = 50, extra = {}) => ({ id, type: 'text', text: id, x, y, width: w, height: h, ...extra });

test('membersOf / withMembers:群組裡的卡片一起帶走', () => {
  const g = { id: 'g', type: 'group', x: 0, y: 0, width: 300, height: 300 };
  const a = N('a', 10, 10), b = N('b', 250, 250), c = N('c', 400, 0);
  assert.deepEqual(membersOf([g, a, b, c], g).map(n => n.id), ['a']);
  assert.deepEqual(withMembers([g, a, b, c], ['g', 'c']).map(n => n.id), ['g', 'a', 'c']);
});

test('alignNodes / distribute', () => {
  const a = N('a', 0, 0, 100, 50), b = N('b', 200, 100, 50, 30);
  assert.deepEqual(alignNodes([a, b], 'left'), [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 0, y: 100 }]);
  assert.deepEqual(alignNodes([a, b], 'right').map(p => p.x), [150, 200]);
  assert.deepEqual(alignNodes([a, b], 'vcenter').map(p => p.y), [40, 50]);
  assert.deepEqual(alignNodes([a], 'left'), [{ id: 'a', x: 0, y: 0 }]);
  const c = N('c', 500, 0, 100, 50), m = N('m', 130, 0, 100, 50);
  assert.deepEqual(distribute([c, a, m], 'h').map(p => [p.id, p.x]), [['c', 500], ['a', 0], ['m', 250]]);
  assert.deepEqual(distribute([a, c], 'h').map(p => p.x), [0, 500]);
});

test('snapMove:容許範圍內吸到最近的線,回傳參考線', () => {
  const lines = snapLines([N('s', 100, 100, 100, 100)]);
  assert.deepEqual(snapMove({ x: 103, y: 400, width: 50, height: 50 }, lines, 6), { dx: -3, dy: 0, gx: 100, gy: null });
  assert.deepEqual(snapMove({ x: 120, y: 175, width: 60, height: 50 }, lines, 6), { dx: 0, dy: 0, gx: 150, gy: 200 }); // 中線剛好對齊
  assert.deepEqual(snapMove({ x: 500, y: 500, width: 10, height: 10 }, lines, 6), { dx: 0, dy: 0, gx: null, gy: null });
});

test('copy / paste:新 id、連線跟著、偏移或放到指定位置;不安全的網址略過', () => {
  const board = { nodes: [N('a', 0, 0), N('b', 200, 0), N('c', 0, 300), { id: 'l', type: 'link', url: 'javascript:alert(1)', x: 0, y: 0, width: 10, height: 10 }], edges: [{ id: 'e1', fromNode: 'a', toNode: 'b', label: 'x' }, { id: 'e2', fromNode: 'a', toNode: 'c' }] };
  const frag = copyFragment(board, ['a', 'b']);
  assert.equal(frag.edges.length, 1);
  const text = JSON.stringify(frag);
  const back = parseFragment(text);
  const p = pasteFragment(board, back);
  assert.equal(p.nodes.length, 2);
  assert.ok(p.nodes.every(n => !['a', 'b'].includes(n.id)));
  assert.deepEqual(p.nodes.map(n => [n.x, n.y]), [[40, 40], [240, 40]]);
  assert.deepEqual([p.edges[0].fromNode, p.edges[0].toNode], [p.nodes[0].id, p.nodes[1].id]);
  assert.equal(p.edges[0].label, 'x');
  assert.deepEqual(pasteFragment(board, back, { at: { x: 1000, y: 500 } }).nodes.map(n => [n.x, n.y]), [[1000, 500], [1200, 500]]);
  assert.equal(pasteFragment(board, { nodes: [board.nodes[3]], edges: [] }).nodes.length, 0);
  assert.equal(parseFragment('不是 JSON'), null);
  assert.equal(parseFragment('{"nodes":[]}'), null);
  board.nodes[0].text = '改了';
  assert.equal(frag.nodes[0].text, 'a'); // 複製的是快照
});

test('searchNodes:文字、網址、筆記標題;依位置排序', () => {
  const board = { nodes: [N('t2', 0, 300, 100, 50, { text: '原子習慣 第二章' }), N('t1', 0, 0, 100, 50, { text: '# 原子習慣' }), { id: 'f', type: 'file', file: 'notes/x.md', x: 500, y: 0, width: 10, height: 10 }, { id: 'u', type: 'link', url: 'https://example.org/habits', x: 0, y: 900, width: 10, height: 10 }] };
  assert.deepEqual(searchNodes(board, '原子'), ['t1', 't2']);
  assert.deepEqual(searchNodes(board, '習慣 第二'), ['t2']);
  assert.deepEqual(searchNodes(board, '讀書筆記', f => (f === 'notes/x.md' ? '讀書筆記' : '')), ['f']);
  assert.deepEqual(searchNodes(board, 'HABITS'), ['u']);
  assert.deepEqual(searchNodes(board, '  '), []);
});

test('groupOutline:依位置排成清單;筆記與簡報變成連結;巢狀群組變子清單', () => {
  const board = { nodes: [
    { id: 'g', type: 'group', label: '讀書計畫', x: 0, y: 0, width: 1000, height: 1000 },
    N('t', 0, 20, 100, 50, { text: '# 本月目標\n- 讀完兩本書' }),
    { id: 'f', type: 'file', file: 'notes/a.md', x: 0, y: 100, width: 100, height: 50 },
    { id: 'g2', type: 'group', label: '延伸', x: 0, y: 300, width: 500, height: 300 },
    { id: 'd', type: 'file', file: 'slides/t/x/deck.yml', x: 10, y: 320, width: 100, height: 50 },
    { id: 'u', type: 'link', url: 'https://example.org', x: 10, y: 400, width: 100, height: 50 },
  ], edges: [] };
  const md = groupOutline(board, board.nodes[0], n => (n.file === 'notes/a.md' ? { kind: 'note', title: '原子習慣' } : { kind: 'deck', title: '分享會' }));
  assert.equal(md, '# 讀書計畫\n\n- 本月目標\n  讀完兩本書\n- [[原子習慣]]\n- **延伸**\n  - [[slides:分享會]]\n  - [https://example.org](https://example.org)\n');
});

test('buildBoardSvg:獨立的 SVG(沒有外部資源)、跳脫文字、只匯出選取的部分', () => {
  const board = { nodes: [N('a', 0, 0, 200, 80, { text: '<script>x</script> & 中文', color: '1' }), N('b', 300, 0), { id: 'i', type: 'file', file: 'boards/media/p.webp', x: 0, y: 200, width: 100, height: 100 }], edges: [{ id: 'e', fromNode: 'a', toNode: 'b', label: '下一步' }] };
  const svg = buildBoardSvg(board, { describe: () => ({ kind: 'other', title: '' }), images: new Map([['boards/media/p.webp', 'data:image/webp;base64,AAAA']]) });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(!svg.includes('<script>'));
  assert.match(svg, /&lt;script&gt;x&lt;\/script&gt; &amp;/); assert.match(svg, /中文<\/text>/);
  assert.match(svg, /下一步/);
  assert.match(svg, /href="data:image\/webp;base64,AAAA"/);
  assert.ok(!/href="https?:/.test(svg));
  const part = buildBoardSvg(board, { describe: () => ({ kind: 'other', title: '' }), only: ['b'] });
  assert.ok(!part.includes('下一步') && !part.includes('中文'));
  assert.deepEqual(wrapText('一二三四五', 30, 10), ['一二三', '四五']);
});

test('strokesToSvg:筆畫變成一張圖,位置是筆畫的外框', () => {
  const r = strokesToSvg([[{ x: 10, y: 10 }, { x: 50, y: 30 }], [{ x: 20, y: 60 }]], { width: 2 });
  assert.deepEqual([r.x, r.y, r.width, r.height], [6, 6, 48, 58]);
  assert.match(r.svg, /<path d="M 4\.0 4\.0 L 44\.0 24\.0"\/>/);
  assert.equal(strokesToSvg([]), null);
});
