// 畫布編輯工具的純函式。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membersOf, withMembers, alignNodes, distribute, snapLines, snapMove, copyFragment, parseFragment, pasteFragment, searchNodes, groupOutline, boardOutline, buildBoardSvg, wrapText, strokesToSvg } from '../app/core/canvas-ops.js';

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

test('reorderNodes:群組永遠在卡片底下,各自範圍內移到最上／最下', async () => {
  const { reorderNodes } = await import('../app/core/canvas-ops.js');
  const G = id => ({ id, type: 'group', x: 0, y: 0, width: 10, height: 10 });
  const list = [G('g1'), G('g2'), N('a', 0, 0), N('b', 0, 0), N('c', 0, 0)];
  const ids = l => l.map(n => n.id).join(',');
  assert.equal(ids(reorderNodes(list, ['a'], 'front')), 'g1,g2,b,c,a');
  assert.equal(ids(reorderNodes(list, ['c'], 'back')), 'g1,g2,c,a,b', '卡片移到最下也不會跑到群組底下');
  assert.equal(ids(reorderNodes(list, ['g1'], 'front')), 'g2,g1,a,b,c', '群組移到最上也還在卡片底下');
  assert.equal(ids(reorderNodes(list, ['c', 'a'], 'front')), 'g1,g2,b,a,c', '多張一起移,保持原本相對順序');
  assert.equal(list.length, 5, '不改動原陣列');
});

test('minimapFrame:包住卡片與目前位置,撐成小地圖的長寬比', async () => {
  const { minimapFrame } = await import('../app/core/canvas-ops.js');
  const f = minimapFrame({ x: 0, y: 0, width: 1000, height: 500 }, { x: 800, y: 400, width: 400, height: 300 }, 2, 0);
  assert.ok(f.x <= 0 && f.y <= 0 && f.x + f.width >= 1200 && f.y + f.height >= 700, '兩個範圍都要在裡面');
  assert.ok(Math.abs(f.width / f.height - 2) < 1e-9, '長寬比要符合小地圖框');
  const e = minimapFrame(null, { x: 10, y: 10, width: 300, height: 200 }, 1.5);
  assert.ok(Math.abs(e.width / e.height - 1.5) < 1e-9 && e.x < 10 && e.y < 10, '空畫布只看目前位置,也要留邊');
});

test('boardOutline:頂層群組依位置排、巢狀群組縮排、未分組放最後,連線寫成 → 目標 (文字)', () => {
  const board = {
    nodes: [
      { id: 'g2', type: 'group', label: '右邊', x: 500, y: 0, width: 300, height: 300 },
      { id: 'g1', type: 'group', label: '左邊', x: 0, y: 0, width: 400, height: 500 },
      { id: 'g1a', type: 'group', label: '內層', x: 20, y: 200, width: 360, height: 280 },
      { id: 'a', type: 'text', text: '**甲**\n說明一行', x: 20, y: 40, width: 200, height: 80 },
      { id: 'b', type: 'text', text: '乙', x: 40, y: 240, width: 200, height: 80 },
      { id: 'c', type: 'file', file: 'notes/x/n.md', x: 520, y: 40, width: 200, height: 80 },
      { id: 'd', type: 'link', url: 'https://example.com', x: 0, y: 900, width: 200, height: 80 },
    ],
    edges: [{ id: 'e1', fromNode: 'a', toNode: 'c', label: '導致' }, { id: 'e2', fromNode: 'b', toNode: 'gone' }],
  };
  const describe = n => (n.file === 'notes/x/n.md' ? { kind: 'note', title: '丙筆記' } : { kind: 'other', title: '' });
  const { items, markdown } = boardOutline(board, describe, { title: '畫布', loose: '未分組' });
  assert.deepEqual(items.map(i => [i.id, i.depth]), [['g1', 0], ['a', 1], ['g1a', 1], ['b', 2], ['g2', 0], ['c', 1], ['', 0], ['d', 1]]);
  assert.deepEqual(items.find(i => i.id === 'a').edges, [{ id: 'c', text: '丙筆記', label: '導致' }]);
  assert.deepEqual(items.find(i => i.id === 'b').edges, [], '指向不存在卡片的連線略過');
  assert.equal(markdown, ['# 畫布', '', '## 左邊', '', '- **甲**', '  說明一行', '  - → 丙筆記 (導致)', '- **內層**', '  - 乙', '',
    '## 右邊', '', '- [[丙筆記]]', '', '## 未分組', '', '- [https://example.com](https://example.com)', ''].join('\n'));
});

test('boardOutline:沒有群組時就是一層清單;空畫布沒有項目', () => {
  const board = { nodes: [{ id: 'b', type: 'text', text: '二', x: 0, y: 200, width: 100, height: 50 }, { id: 'a', type: 'text', text: '一', x: 0, y: 0, width: 100, height: 50 }], edges: [] };
  const r = boardOutline(board, () => ({ kind: 'other', title: '' }));
  assert.deepEqual(r.items.map(i => [i.id, i.depth]), [['a', 0], ['b', 0]]);
  assert.equal(r.markdown, '- 一\n- 二\n');
  assert.deepEqual(boardOutline({ nodes: [], edges: [] }, () => ({})).items, []);
});

import { inGroup, groupAt, growGroups } from '../app/core/canvas-ops.js';

test('群組成員看中心點:卡片長出框外一點還在組裡;比框大的不算;不會互為成員', () => {
  const g = { id: 'g', type: 'group', x: 0, y: 0, width: 300, height: 300 };
  const tall = N('t', 20, 20, 200, 400);       // 中心 (120, 220),超出下緣
  const out = N('o', 280, 280, 100, 100);      // 中心 (330, 330) 在框外
  assert.equal(inGroup(tall, g), true);
  assert.equal(inGroup(out, g), false);
  assert.equal(inGroup(N('huge', 0, 0, 280, 2000), g), false, '中心點跑到框外就不算');
  assert.equal(inGroup(N('wide', 0, 0, 900, 200), { ...g, width: 1000 }), true, '卡片比框大也算(只要中心在裡面)');
  const same = { id: 'h', type: 'group', x: 0, y: 0, width: 300, height: 300 };
  assert.equal(inGroup(same, g), false);
  assert.equal(inGroup(g, same), false);
  const inner = { id: 'i', type: 'group', x: 20, y: 20, width: 100, height: 100 };
  assert.deepEqual(membersOf([g, inner, tall], g).map(n => n.id).sort(), ['i', 't']);
});

test('groupAt:中心點所在最小的群組;正在拖動的群組不算', () => {
  const big = { id: 'big', type: 'group', x: 0, y: 0, width: 1000, height: 1000 };
  const small = { id: 'small', type: 'group', x: 100, y: 100, width: 300, height: 300 };
  const box = { x: 150, y: 150, width: 100, height: 50 };
  assert.equal(groupAt([big, small], box).id, 'small');
  assert.equal(groupAt([big, small], box, new Set(['small'])).id, 'big');
  assert.equal(groupAt([big, small], { x: 2000, y: 0, width: 10, height: 10 }), null);
});

test('growGroups:成員超出框就撐開群組與外層群組,不縮小', () => {
  const outer = { id: 'o', type: 'group', x: 0, y: 0, width: 500, height: 400 };
  const g = { id: 'g', type: 'group', x: 20, y: 20, width: 300, height: 300 };
  const a = N('a', 40, 40, 200, 340); // 下緣 380,超出 g(320)
  const out = growGroups([outer, g, a], ['a'], 24);
  const byId = Object.fromEntries(out.map(c => [c.id, c]));
  assert.deepEqual(byId.g, { id: 'g', x: 16, y: 16, width: 304, height: 388 });
  assert.equal(byId.o.y + byId.o.height, 428, '外層也跟著長(包住 g 再留 24)');
  assert.deepEqual(growGroups([g, N('b', 50, 50)], ['b']), [], '沒超出就不改');
  assert.deepEqual(growGroups([g, N('c', 900, 900)], ['c']), [], '不在組裡就不改');
  // 一下子長很多:中心點已經在框外,但用變大前的位置判斷,本來就在這組
  const grown = N('d', 40, 40, 200, 2000);
  const ch = growGroups([g, grown], ['d'], 24, new Map([['d', { x: 40, y: 40, width: 200, height: 100 }]]));
  assert.equal(ch[0].y + ch[0].height, 2064);
});
