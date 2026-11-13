// AI 生成:提示詞精簡且帶齊資料;AI 的回覆組成正確的筆記、簡報、畫布檔案;組出來的書庫通過檢查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLang } from '../app/core/i18n.js';
import { buildPrompt, aiURL, assembleGenerated, parseOutline, outlineToCanvas, PREFILL_MAX, SPEC_URLS, specPath } from '../app/core/generate.js';
import { existsSync, readFileSync } from 'node:fs';
import { parseCanvas } from '../app/core/canvas.js';
import { memorySource } from './helpers.mjs';
import { checkVault } from '../app/core/check.js';

setLang('zh-Hant');
const base = { topicId: '10-reading', title: '原子習慣', today: '2026-11-13' };

test('generate:提示詞很短,請 AI 先讀規格網址、交完整書庫包,帶齊主題資料夾、標題、要求與資料', () => {
  for (const kind of ['note', 'deck', 'board']) {
    const p = buildPrompt({ kind, title: '原子習慣', topic: '讀書', topicId: '10-reading', extra: '給新手看', data: '劃線一\n劃線二' });
    assert.ok(p.includes(SPEC_URLS['zh-Hant']), kind);
    assert.match(p, /10-reading/); assert.match(p, /原子習慣/); assert.match(p, /讀書/); assert.match(p, /給新手看/);
    assert.match(p, /zip/); assert.match(p, /劃線一\n劃線二$/);
    assert.ok(p.length - '劃線一\n劃線二'.length < 400, `${kind} 的提示詞太長:${p.length}`);
  }
  assert.doesNotMatch(buildPrompt({ kind: 'note', title: 'a', data: 'b' }), /\n\n\n/, '沒有補充要求時不留空行');
  assert.match(buildPrompt({ kind: 'note', title: 'a', data: 'b' }), /01-inbox/, '沒選主題時用收件匣');
  setLang('en');
  const en = buildPrompt({ kind: 'deck', title: 'T', data: 'x', lang: 'en' });
  assert.match(en, /^First read the Leafpile library pack spec/); assert.ok(en.includes(SPEC_URLS.en));
  setLang('zh-Hant');
});

test('generate:規格網址指向倉庫裡真的存在的檔案(改檔名時要一起改)', () => {
  for (const [lang, url] of Object.entries(SPEC_URLS)) {
    assert.ok(url.endsWith('/main/' + specPath(lang)), url);
    assert.ok(existsSync(new URL('../' + specPath(lang), import.meta.url)), specPath(lang));
  }
});

test('generate:照 AI_PACK 規格範例做出的書庫包,匯入後通過檢查', async () => {
  for (const lang of ['zh-Hant', 'en']) {
    const doc = readFileSync(new URL('../' + specPath(lang), import.meta.url), 'utf8');
    // 規格裡的範例:筆記(第 3 節)、deck.yml 與投影片(第 4 節)、畫布(第 5 節)
    const blocks = [...doc.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map(m => ({ lang: m[1], body: m[2] }));
    const note = blocks.find(b => b.lang === 'markdown' && /^---\ntitle:/.test(b.body)).body
      .replace(/^source: .*\n/m, '').replace(/\[\[[^\]]+\]\]/, '[[overview]]');
    const deck = blocks.find(b => b.lang === 'yaml' && /^mdslide: 1/.test(b.body)).body;
    const slide = blocks.find(b => b.lang === 'markdown' && /^# /.test(b.body) && /Note:/.test(b.body)).body;
    const board = blocks.find(b => b.lang === 'json').body;
    JSON.parse(board);
    const d = 'slides/10-reading/2026-11-atomic-habits-share';
    const lib = {
      '_site.yml': 'leafpile: 1\ntitle: t\n', 'notes/10-reading/_topic.yml': 'name: r\n',
      'notes/10-reading/2026-11-13-atomic-habits.md': note,
      'notes/10-reading/2026-11-13-overview.md': '---\ntitle: overview\ndate: 2026-11-13\n---\n# overview\n',
      [`${d}/deck.yml`]: deck,
      [`${d}/01-why/01-hook.md`]: slide,
      [`${d}/02-how/01-four-laws.md`]: '<!-- layout: stats -->\n# t\n- **3x** a\n- **12** b\n',
      'boards/atomic-habits-map.canvas': board,
    };
    const r = await checkVault(memorySource(lib));
    assert.deepEqual(r.problems, [], `${lang}: ${JSON.stringify(r.problems)}`);
    const files = assembleGenerated({ ...base, kind: 'note', text: Object.entries(lib).map(([p, x]) => `=== FILE: ${p} ===\n${x}\n=== END ===`).join('\n') });
    assert.equal(files.length, Object.keys(lib).length, '完整書庫包照原樣匯入');
  }
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

test('資料留空(改在 AI 那邊上傳檔案)時,提示詞改成指向附件,不留空的「資料:」', () => {
  for (const kind of ['note', 'deck', 'board']) {
    const p = buildPrompt({ kind, title: 'T', data: '  ' });
    assert.doesNotMatch(p, /資料:\s*$/, kind);
    assert.match(p, /附件/, kind);
  }
});
