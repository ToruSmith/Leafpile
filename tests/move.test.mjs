// 筆記的改名與搬移:連結更新、標題、檔名、相對路徑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memorySource } from './helpers.mjs';
import { openVault } from '../app/core/vault.js';
import { buildGraph } from '../app/core/graph.js';
import { replaceWikilinks, formatWikilink, parseNote } from '../app/core/note.js';
import { planLinkUpdates, retitle, renamedFile, rebaseLinks, retargetSource } from '../app/core/move.js';

const lib = {
  'notes/10-reading/2026-11-12-原子習慣.md': '---\ntitle: 原子習慣\naliases: [AH]\n---\n# 原子習慣\n看 [[其他]]。\n![圖](media/cover.png)\n',
  'notes/10-reading/其他.md': '# 其他\n[[原子習慣#第一章|讀這章]]、[[AH]]、[[2026-11-12-原子習慣]]、[[10-reading/2026-11-12-原子習慣]]、`[[原子習慣]]`\n```\n[[原子習慣]]\n```\n',
  'notes/20-work/新名字.md': '# 新名字\n',
  'notes/20-work/工作.md': '# 工作\n![[原子習慣#重點]]\n',
  'slides/10-reading/share/deck.yml': 'title: 分享\nsource: notes/10-reading/2026-11-12-原子習慣\nsource_hash: "00000000"\n',
  'slides/10-reading/share/01.md': '# 封面\n[[原子習慣]]\n',
};

async function setup() {
  const g = await buildGraph(await openVault(memorySource(lib)));
  const records = [...g.notes.values(), ...g.decks.values()];
  const from = g.notes.get('notes/10-reading/2026-11-12-原子習慣.md');
  const files = Object.entries(lib).filter(([p]) => p.endsWith('.md')).map(([path, text]) => ({ path, text, topicId: path.split('/')[1] }));
  return { records, from, files };
}

test('replaceWikilinks:只改函式回傳的;程式碼裡的不碰;formatWikilink 寫回原樣', () => {
  const src = '[[a#h|顯示]] ![[b]] `[[a]]`\n```\n[[a]]\n```\n[[slides:c]]';
  const same = replaceWikilinks(src, l => formatWikilink(l));
  assert.equal(same.text, src);
  const r = replaceWikilinks(src, l => (l.target === 'a' ? formatWikilink({ ...l, target: 'z' }) : null));
  assert.equal(r.count, 1);
  assert.equal(r.text, '[[z#h|顯示]] ![[b]] `[[a]]`\n```\n[[a]]\n```\n[[slides:c]]');
});

test('改名:斷掉的連結改寫,保留 #標題 與 |顯示文字;別名與程式碼不動;撞名時改用路徑', async () => {
  const { records, from, files } = await setup();
  const to = { path: 'notes/10-reading/2026-11-12-新名字.md', rel: '10-reading/2026-11-12-新名字.md', topicId: '10-reading', title: '新名字' };
  const { edits, count } = planLinkUpdates({ records, files, from, to });
  const by = Object.fromEntries(edits.map(e => [e.path, e.text]));
  assert.equal(by['notes/10-reading/其他.md'],
    '# 其他\n[[新名字#第一章|讀這章]]、[[AH]]、[[新名字]]、[[新名字]]、`[[原子習慣]]`\n```\n[[原子習慣]]\n```\n');
  // 20-work 裡也有一篇「新名字」:同主題優先會找錯,所以用路徑
  assert.equal(by['notes/20-work/工作.md'], '# 工作\n![[10-reading/2026-11-12-新名字#重點]]\n');
  assert.equal(by['slides/10-reading/share/01.md'], '# 封面\n[[新名字]]\n');
  assert.equal(count, 5);
  assert.ok(!by['notes/20-work/新名字.md']);
});

test('搬移(標題不變):用標題寫的連結仍然有效,不改;用路徑寫的才改', async () => {
  const { records, from, files } = await setup();
  const to = { path: 'notes/20-work/2026-11-12-原子習慣.md', rel: '20-work/2026-11-12-原子習慣.md', topicId: '20-work', title: '原子習慣' };
  const { edits } = planLinkUpdates({ records, files, from, to });
  assert.deepEqual(edits.map(e => e.path), ['notes/10-reading/其他.md']);
  assert.match(edits[0].text, /\[\[原子習慣#第一章\|讀這章\]\]、\[\[AH\]\]、\[\[2026-11-12-原子習慣\]\]、\[\[原子習慣\]\]/);
});

test('retitle:改 front matter 的 title,或第一個 # 標題(跳過程式碼),或補上 title', () => {
  assert.equal(retitle('---\ntitle: 舊\ntags: [a]\n---\n# 舊\n內容', '新'), '---\ntitle: 新\ntags: [a]\n---\n# 舊\n內容');
  assert.equal(retitle('---\ntitle: 舊\n---\n# 舊\n內容', '新', '舊'), '---\ntitle: 新\n---\n# 新\n內容'); // H1 跟舊標題一樣:一起改
  assert.equal(retitle('---\ntitle: 舊\n---\n# 副標\n內容', '新', '舊'), '---\ntitle: 新\n---\n# 副標\n內容');
  assert.equal(retitle('```\n# 不是\n```\n# 舊\n內容', '新'), '```\n# 不是\n```\n# 新\n內容');
  assert.equal(retitle('---\ntags: [a]\n---\n內容', '新'), '---\ntags: [a]\ntitle: 新\n---\n內容');
  assert.equal(retitle('內容', 'a: b'), '---\ntitle: "a: b"\n---\n內容');
  assert.equal(parseNote(retitle('---\ntitle: 舊\n---\nx', '#1 好書'), { path: 'x.md' }).title, '#1 好書');
});

test('renamedFile:保留日期或排序前綴,拿掉檔名不能用的字元', () => {
  assert.equal(renamedFile('2026-11-12-原子習慣.md', '新 名字'), '2026-11-12-新-名字.md');
  assert.equal(renamedFile('03-第三章.md', 'A/B: C?'), '03-AB-C.md');
  assert.equal(renamedFile('無前綴.md', '新'), '新.md');
});

test('rebaseLinks:相對路徑的圖片與連結換算到新資料夾;網址、錨點、程式碼不動', () => {
  const src = '![a](media/x.png) [b](../20-work/y.md#h) [c](https://e.com) [d](#top) ![e](<my img.png> "t")\n```\n![z](media/z.png)\n```';
  assert.equal(rebaseLinks(src, '10-reading/book', '20-work'),
    '![a](../10-reading/book/media/x.png) [b](../10-reading/20-work/y.md#h) [c](https://e.com) [d](#top) ![e](<../10-reading/book/my img.png> "t")\n```\n![z](media/z.png)\n```');
  assert.equal(rebaseLinks('![a](media/x.png)', '10-reading', '10-reading/book'), '![a](../media/x.png)');
  assert.equal(rebaseLinks('![a](x.png)', '', '10-reading'), '![a](../x.png)');
  assert.equal(rebaseLinks('![a](../../../x.png)', 'a', 'b'), '![a](../../../x.png)'); // 跑出書庫:不動
});

test('retargetSource:只有 source 指到這篇時才改,而且只改那一行', () => {
  const yml = 'title: 分享\nsource: notes/10-reading/2026-11-12-原子習慣\nsource_hash: "00000000"\n';
  assert.equal(retargetSource(yml, 'notes/10-reading/2026-11-12-原子習慣.md', 'notes/20-work/x.md'),
    'title: 分享\nsource: notes/20-work/x\nsource_hash: "00000000"\n');
  assert.equal(retargetSource(yml, 'notes/10-reading/別篇.md', 'notes/x.md'), null);
  assert.equal(retargetSource('title: a\n', 'notes/x.md', 'notes/y.md'), null);
});
