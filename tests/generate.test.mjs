// AI 生成:提示詞精簡且帶齊資料;AI 的回覆組成正確的筆記、簡報、畫布檔案;組出來的書庫通過檢查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLang } from '../app/core/i18n.js';
import { buildPrompt, aiURL, assembleGenerated, parseOutline, outlineToCanvas, PREFILL_MAX } from '../app/core/generate.js';
import { parseCanvas } from '../app/core/canvas.js';
import { memorySource } from './helpers.mjs';
import { checkVault } from '../app/core/check.js';

setLang('zh-Hant');
const base = { topicId: '10-reading', title: '原子習慣', today: '2026-11-13' };

test('generate:提示詞帶標題、主題、補充要求與資料,而且精簡', () => {
  for (const kind of ['note', 'deck', 'board']) {
    const p = buildPrompt({ kind, title: '原子習慣', topic: '讀書', extra: '給新手看', data: '劃線一\n劃線二' });
    assert.match(p, /原子習慣/); assert.match(p, /讀書/); assert.match(p, /給新手看/); assert.match(p, /劃線一\n劃線二$/);
    assert.match(p, /=== FILE: 原子習慣\.md ===/);
    assert.ok(p.length - '劃線一\n劃線二'.length < 450, `${kind} 的提示詞太長:${p.length}`);
  }
  assert.doesNotMatch(buildPrompt({ kind: 'note', title: 'a', data: 'b' }), /\n\n\n/, '沒有補充要求時不留空行');
  setLang('en');
  assert.match(buildPrompt({ kind: 'deck', title: 'T', data: 'x' }), /^Turn the material/);
  setLang('zh-Hant');
});

test('generate:AI 網址,短的帶入、長的只開網站', () => {
  assert.equal(aiURL('claude', 'hi'), 'https://claude.ai/new?q=hi');
  assert.equal(aiURL('chatgpt', 'a b'), 'https://chatgpt.com/?q=a%20b');
  assert.equal(aiURL('gemini', 'hi'), 'https://gemini.google.com/app');
  assert.equal(aiURL('claude', 'x'.repeat(PREFILL_MAX + 1)), 'https://claude.ai/new');
});

test('generate:筆記,補上 front matter 與檔名,多篇各自一個檔案,重名加編號', () => {
  const reply = '好的:\n=== FILE: 原子習慣.md ===\n# 原子習慣\n\n## 重點\n- 甲\n=== END ===\n=== FILE: 第二篇.md ===\n內文\n=== END ===\n=== FILE: 原子習慣.md ===\n# 原子習慣\n再一次\n=== END ===';
  const files = assembleGenerated({ ...base, kind: 'note', text: reply });
  assert.deepEqual(files.map(f => f.path), ['notes/10-reading/2026-11-13-原子習慣.md', 'notes/10-reading/2026-11-13-第二篇.md', 'notes/10-reading/2026-11-13-原子習慣-2.md']);
  assert.match(files[0].data, /^---\ntitle: 原子習慣\ndate: 2026-11-13\ntags: \[\]\n---\n# 原子習慣\n\n## 重點\n- 甲\n$/);
  assert.equal(files[0].data.match(/^# /gm).length, 1, '標題不要重複');
});

test('generate:沒有 FILE 標記時,整段當成一份;新主題補上 _topic.yml', () => {
  const files = assembleGenerated({ ...base, kind: 'note', text: '# 只貼了 Markdown\n\n內文', topicId: '01-inbox', topicName: '收件匣', newTopic: true });
  assert.deepEqual(files.map(f => f.path), ['notes/01-inbox/_topic.yml', 'notes/01-inbox/2026-11-13-只貼了-Markdown.md']);
  assert.match(files[0].data, /name: 收件匣/);
});

test('generate:簡報,大綱 → 章節資料夾、投影片與 deck.yml(沒有 source)', () => {
  const reply = '=== FILE: 原子習慣.md ===\n# 原子習慣分享\n## 為什麼\n### 小習慣的複利\n- 每天 1%\n### 系統勝過目標\n- 重點\n## 怎麼做\n### 四個法則\n- 提示\n=== END ===';
  const files = assembleGenerated({ ...base, kind: 'deck', text: reply });
  const paths = files.map(f => f.path);
  const dir = 'slides/10-reading/2026-11-13-原子習慣分享/';
  assert.ok(paths.every(p => p.startsWith(dir)), paths.join('\n'));
  assert.ok(paths.includes(dir + 'deck.yml'));
  assert.equal(paths.filter(p => p.endsWith('.md')).length, 3);
  const deck = files.find(f => f.path.endsWith('deck.yml')).data;
  assert.match(deck, /title: 原子習慣分享/);
  assert.doesNotMatch(deck, /source/);
});

test('generate:畫布,群組成欄、卡片不重疊、連線依卡片文字對上', () => {
  const o = parseOutline('## 問題\n- 習慣難養成\n- 目標太大\n## 方法\n- 讓它顯而易見\n## 連線\n- 目標太大 -> 讓它顯而易見 : 解法\n- 不存在 -> 習慣難養成');
  assert.deepEqual(o.groups.map(g => [g.label, g.cards.length]), [['問題', 2], ['方法', 1]]);
  assert.equal(o.links.length, 2);
  const c = outlineToCanvas(o);
  const cards = c.nodes.filter(n => n.type === 'text'), groups = c.nodes.filter(n => n.type === 'group');
  assert.equal(groups.length, 2); assert.equal(cards.length, 3);
  for (const a of cards) for (const b of cards) if (a !== b) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, '卡片不能重疊');
  for (const card of cards) { const g = groups.find(x => card.x >= x.x && card.x + card.width <= x.x + x.width); assert.ok(g && card.y + card.height <= g.y + g.height, '卡片要在群組裡'); }
  assert.deepEqual(c.edges.map(e => e.label), ['解法'], '對不上的連線略過');
  const files = assembleGenerated({ ...base, kind: 'board', text: '## 問題\n- 甲' });
  assert.equal(files[0].path, 'boards/原子習慣.canvas');
  assert.equal(parseCanvas(files[0].data).nodes.length, 2);
});

test('generate:回覆已經是完整書庫包(有 notes/ 路徑)時照原樣', () => {
  const files = assembleGenerated({ ...base, kind: 'note', text: '=== FILE: notes/20-work/a.md ===\n# a\n=== END ===\n=== FILE: evil/x.md ===\nx\n=== END ===' });
  assert.deepEqual(files.map(f => f.path), ['notes/20-work/a.md']);
});

test('generate:三種組出來的檔案放進書庫都通過檢查', async () => {
  const lib = { '_site.yml': 'leafpile: 1\ntitle: t\n', 'notes/10-reading/_topic.yml': 'name: 讀書\n' };
  const add = list => { for (const f of list) lib[f.path] = f.data; };
  add(assembleGenerated({ ...base, kind: 'note', text: '# 原子習慣\n\n## 重點\n- 甲' }));
  add(assembleGenerated({ ...base, kind: 'deck', text: '# 分享\n## 一\n### 甲\n- a\n### 乙\n- b' }));
  add(assembleGenerated({ ...base, kind: 'board', text: '## 群\n- 卡' }));
  const r = await checkVault(memorySource(lib));
  assert.deepEqual(r.problems, [], JSON.stringify(r.problems));
});
