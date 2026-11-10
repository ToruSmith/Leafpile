// Leafpile 新增的 core:筆記解析、[[連結]]、公開規則、雙渠道書庫、圖譜。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memorySource } from './helpers.mjs';
import { nodeSource } from '../scripts/node-source.mjs';
import { parseNote, splitFrontMatter, headingsOf, wikilinksOf, sectionOf, slugify, parseTarget, linkLabel } from '../app/core/note.js';
import { createResolver, computeBacklinks } from '../app/core/links.js';
import { resolvePublic, isLocalOnly, publishable, scanPII } from '../app/core/privacy.js';
import { openVault, subSource, findNote, findDeck, notesOfTopic } from '../app/core/vault.js';
import { buildGraph, searchGraph } from '../app/core/graph.js';
import { renderMarkdown } from '../app/core/markdown.js';

// ---------------- note.js ----------------

test('front matter:全部可省略;解析失敗不會讓整篇消失', () => {
  assert.deepEqual(splitFrontMatter('# 甲').data, {});
  const bad = splitFrontMatter('---\ntitle: [a\n---\n# 甲');
  assert.ok(bad.error);
  assert.equal(bad.body, '# 甲');
});

test('標題:front matter → 第一個 # → 檔名(去前綴與日期)', () => {
  assert.equal(parseNote('---\ntitle: 甲\n---\n# 乙', { path: 'a/01-丙.md' }).title, '甲');
  assert.equal(parseNote('文字\n# 乙', { path: 'a/01-丙.md' }).title, '乙');
  const n = parseNote('沒有標題', { path: 'a/2026-11-09-丙.md' });
  assert.equal(n.title, '丙');
  assert.equal(n.date, '2026-11-09');
});

test('tags、aliases 接受陣列或逗號字串;public 只認布林', () => {
  const n = parseNote('---\ntags: 習慣, 讀書會\naliases: [第一章]\npublic: "yes"\n---\n', { path: 'x.md' });
  assert.deepEqual(n.tags, ['習慣', '讀書會']);
  assert.deepEqual(n.aliases, ['第一章']);
  assert.equal(n.public, undefined);
});

test('筆記裡寫版型設定會被提醒', () => {
  const n = parseNote('---\nlayout: split\nsize: large\n---\n# x', { path: 'x.md' });
  assert.deepEqual(n.layoutKeys, ['layout', 'size']);
  assert.equal(n.issues.length, 1);
});

test('標題 slug 與 markdown 的 id 一致,重複時加編號', () => {
  const body = '# 標題 A\n```\n# 不是標題\n```\n## 標題 A\n### **粗體** [連結](x)';
  const hs = headingsOf(body);
  assert.deepEqual(hs.map(h => h.slug), ['標題-a', '標題-a-2', '粗體-連結']);
  const html = renderMarkdown(body, { headingIds: true });
  for (const h of hs) assert.ok(html.includes(`id="h-${h.slug}"`), h.slug);
  assert.equal(slugify('Hello, World!'), 'hello-world');
});

test('[[連結]]:目標、段落、顯示文字、簡報、摘錄;程式碼裡的不算', () => {
  const links = wikilinksOf('看 [[兩個渠道#一句話]]、[[slides:tour|導覽]]\n![[筆記#重點]] `[[不是]]`\n```\n[[也不是]]\n```');
  assert.deepEqual(links.map(l => [l.channel, l.target, l.heading, l.label, l.embed]), [
    ['notes', '兩個渠道', '一句話', '', false],
    ['slides', 'tour', '', '導覽', false],
    ['notes', '筆記', '重點', '', true],
  ]);
  assert.deepEqual(parseTarget('#只有段落'), { channel: 'notes', target: '', heading: '只有段落' });
  assert.equal(linkLabel({ target: 'a/b/c', heading: 'd' }), 'c › d');
});

test('sectionOf:取出某個標題底下到下一個同級標題之前', () => {
  const body = '# 甲\n## 一句話\n第一行\n### 細節\n第二行\n## 下一段\n不要';
  assert.equal(sectionOf(body, '一句話'), '第一行\n### 細節\n第二行');
  assert.equal(sectionOf(body, '細節'), '第二行');
  assert.equal(sectionOf(body, '沒有'), null);
});

// ---------------- privacy.js ----------------

test('公開規則:筆記 > 筆記本 > 主題 > 私人;local_only 一律不能公開', () => {
  assert.equal(resolvePublic({}), false);
  assert.equal(resolvePublic({ topic: { public: true } }), true);
  assert.equal(resolvePublic({ book: { public: false }, topic: { public: true } }), false);
  assert.equal(resolvePublic({ note: { public: true }, book: { public: false } }), true);
  assert.equal(isLocalOnly({ local_only: true }), true);
  assert.deepEqual(publishable({ note: { public: true }, topic: { local_only: true } }), { ok: false, reason: 'local-only' });
  assert.deepEqual(scanPII('寄到 a@b.co\n```\nA123456789\n```').map(x => x.key), ['email']);
});

// ---------------- links.js ----------------

const recs = [
  { kind: 'note', path: 'notes/10-r/01-兩個渠道.md', rel: '10-r/01-兩個渠道.md', topicId: '10-r', title: '兩個渠道', aliases: ['雙渠道'], date: '2026-11-01', links: [{ channel: 'slides', target: 'tour' }] },
  { kind: 'note', path: 'notes/10-r/重點.md', rel: '10-r/重點.md', topicId: '10-r', title: '重點', date: '2026-11-02', links: [{ channel: 'notes', target: '雙渠道' }] },
  { kind: 'note', path: 'notes/20-w/重點.md', rel: '20-w/重點.md', topicId: '20-w', title: '重點', date: '2026-11-05', links: [] },
  { kind: 'deck', path: 'slides/10-r/2026-11-tour', rel: '10-r/2026-11-tour', topicId: '10-r', title: '導覽', folder: '2026-11-tour', date: '2026-11-09', source: 'notes/10-r/01-兩個渠道', links: [] },
];

test('比對:標題、別名、檔名、去前綴、路徑都找得到', () => {
  const { resolve } = createResolver(recs);
  for (const target of ['兩個渠道', '雙渠道', '01-兩個渠道', '10-r/01-兩個渠道', 'notes/10-r/01-兩個渠道.md']) {
    assert.equal(resolve({ channel: 'notes', target }).target?.path, 'notes/10-r/01-兩個渠道.md', target);
  }
  for (const target of ['導覽', 'tour', '2026-11-tour', 'slides/10-r/2026-11-tour']) assert.equal(resolve({ channel: 'slides', target }).target?.kind, 'deck', target);
  assert.equal(resolve({ channel: 'notes', target: '不存在' }).status, 'missing');
});

test('重名:同主題優先,其次較新;同一層仍有多個 = ambiguous', () => {
  const { resolve } = createResolver(recs);
  assert.equal(resolve({ channel: 'notes', target: '重點' }, { fromTopic: '10-r' }).target.path, 'notes/10-r/重點.md');
  assert.equal(resolve({ channel: 'notes', target: '重點' }, { fromTopic: '20-w' }).status, 'ok');
  const r = resolve({ channel: 'notes', target: '重點' }, { fromTopic: '99-x' });
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.target.path, 'notes/20-w/重點.md');
});

test('反向連結:筆記連結與簡報的 source 都算,簡報只算一個點', () => {
  const resolver = createResolver(recs);
  const back = computeBacklinks(recs, resolver);
  const toNote = back.get('notes/10-r/01-兩個渠道.md');
  assert.deepEqual(toNote.map(x => [x.from.path, x.via]), [['notes/10-r/重點.md', 'link'], ['slides/10-r/2026-11-tour', 'source']]);
  assert.deepEqual(back.get('slides/10-r/2026-11-tour').map(x => x.from.path), ['notes/10-r/01-兩個渠道.md']);
});

// ---------------- vault.js ----------------

const files = {
  '_site.yml': 'leafpile: 1\ntitle: 我的頁堆\ncategories:\n  - id: learning\n    name: 學習\n',
  'notes/10-reading/_topic.yml': 'name: 讀書筆記\ncategory: learning\npublic: false\n',
  'notes/10-reading/2026-11-book/_book.yml': 'title: 原子習慣\nauthor: J\npublic: true\n',
  'notes/10-reading/2026-11-book/01-ch1.md': '---\ntitle: 第一章\n---\n連到 [[第二章]] 與 [[slides:分享]]',
  'notes/10-reading/2026-11-book/02-ch2.md': '# 第二章\n## 重點\n內容',
  'notes/10-reading/2026-11-book/media/a.png': 'x',
  'notes/10-reading/2026-10-loose.md': '# 散篇\n[[不存在]]',
  'notes/10-reading/_draft.md': '# 草稿',
  'notes/50-life/_topic.yml': 'name: 生活\nlocal_only: true\n',
  'notes/50-life/x.md': '# x',
  'notes/inbox.md': '# 未歸檔',
  'slides/10-reading/2026-11-share/deck.yml': 'title: 分享\nsource: notes/10-reading/2026-11-book\n',
  'slides/10-reading/2026-11-share/01-a/01.md': '# 一\n見 [[第一章]]',
  'slides/20-work/_topic.yml': 'name: 工作\n',
  'slides/20-work/q4/01.md': '# Q4',
};

test('openVault:雙渠道、同名主題配對、筆記本、草稿與素材資料夾略過', async () => {
  const src = memorySource(files, 'lib');
  const v = await openVault(src);
  assert.equal(v.kind, 'leafpile');
  assert.equal(v.title, '我的頁堆');
  assert.deepEqual(v.topics.map(tp => tp.id), ['_', '10-reading', '20-work', '50-life']);
  const reading = v.topics.find(tp => tp.id === '10-reading');
  assert.equal(reading.title, '讀書筆記');
  assert.equal(reading.decks.length, 1);
  assert.deepEqual(reading.notes.items.map(i => [i.kind, i.title]), [['book', '原子習慣'], ['note', 'loose']]);
  assert.deepEqual(notesOfTopic(reading.notes).map(n => n.path), ['10-reading/2026-11-book/01-ch1.md', '10-reading/2026-11-book/02-ch2.md', '10-reading/2026-10-loose.md']);
  assert.deepEqual(v.categories.map(c => [c.name, c.topics.map(tp => tp.id)]), [['學習', ['10-reading']], ['其他', ['_', '20-work', '50-life']]]);
  assert.ok(findNote(v, '10-reading/2026-11-book/02-ch2.md').book);
  assert.ok(findDeck(v, '20-work', 'q4'));
  assert.ok(!src.reads.some(p => p.endsWith('.md')), '開書架時不讀任何筆記或投影片');
});

test('openVault:沒有 notes/ 與 slides/ 就當成 Mdslide Pile 書庫', async () => {
  const v = await openVault(memorySource({ '01-a/deck-x/01.md': '# 1', '01-a/deck-y/01.md': '# 2' }));
  assert.equal(v.kind, 'mdslide');
  assert.equal(v.slidesPrefix, '');
  assert.equal(v.topics[0].decks.length, 2);
});

test('subSource:路徑加前綴;封存一律搬到書庫根目錄的 _archive/', async () => {
  const calls = [];
  const parent = { ...memorySource({ 'slides/a/b.md': 'x' }), canWrite: true, ensureWritable: async () => true, stat: async p => p, writeText: async (p, t) => calls.push(['w', p]), archive: async (p, d) => (calls.push(['a', p, d]), d) };
  const sub = subSource(parent, 'slides');
  assert.equal(await sub.readText('a/b.md'), 'x');
  await sub.writeText('a/c.md', 'y');
  await sub.archive('a/b.md');
  assert.deepEqual(calls, [['w', 'slides/a/c.md'], ['a', 'slides/a/b.md', '_archive/slides/a']]);
});

test('buildGraph:標題補齊、公開判斷、連結、反向連結、搜尋', async () => {
  const v = await openVault(memorySource(files, 'lib'));
  const g = await buildGraph(v);
  const ch1 = g.notes.get('notes/10-reading/2026-11-book/01-ch1.md');
  assert.equal(ch1.title, '第一章');
  assert.equal(ch1.public, true, '筆記本設為公開');
  assert.equal(g.notes.get('notes/10-reading/2026-10-loose.md').public, false, '主題預設私人');
  assert.equal(g.notes.get('notes/50-life/x.md').localOnly, true);
  const back = g.backlinks.get('notes/10-reading/2026-11-book/02-ch2.md').map(x => x.from.path);
  assert.deepEqual(back.sort(), ['notes/10-reading/2026-11-book/01-ch1.md', 'slides/10-reading/2026-11-share']);
  assert.deepEqual(g.backlinks.get('notes/10-reading/2026-11-book/01-ch1.md').map(x => x.from.path), ['slides/10-reading/2026-11-share']);
  assert.equal(v.topics.find(tp => tp.id === '10-reading').notes.items[0].notes[1].title, '第二章', '書架上的卡片也補上標題');
  assert.deepEqual(searchGraph(g, '第二 重點').map(r => r.path), ['notes/10-reading/2026-11-book/02-ch2.md']);
  assert.equal(searchGraph(g, '分享')[0].kind, 'deck');
});

test('內建 content/ 是合法的 Leafpile 書庫,而且範例之間的連結都找得到', async () => {
  const v = await openVault(nodeSource(new URL('../content', import.meta.url).pathname));
  assert.equal(v.kind, 'leafpile');
  assert.deepEqual(v.issues, []);
  const g = await buildGraph(v);
  const broken = [];
  for (const r of g.records) for (const l of r.links) {
    const res = g.resolver.resolve(l, { fromTopic: r.topicId, fromPath: r.path });
    if (res.status === 'missing' || res.status === 'ambiguous') broken.push(`${r.path} → ${l.raw}`);
  }
  assert.deepEqual(broken, []);
});

// ---------------- bridge.js / flash.js ----------------
import { expandEmbeds, promoteNote, promoteBook, distillDeck, slideFromSection, safeName } from '../app/core/bridge.js';
import { splitNoteForSlides, noteToDeck } from '../app/player/flash.js';
import { loadDeck } from '../app/core/library.js';
import { checkVault } from '../app/core/check.js';
import { parseSlideFile } from '../app/core/slide.js';

test('快閃播放:有 --- 依它拆,否則依 ## 拆;第一個 # 變成標題頁', () => {
  assert.deepEqual(splitNoteForSlides('# 題\n前言\n## 甲\n1\n```\n## 不算\n```\n## 乙\n2'), ['前言', '## 甲\n1\n```\n## 不算\n```', '## 乙\n2']);
  assert.deepEqual(splitNoteForSlides('# 題\n甲\n## 小\n---\n乙'), ['甲\n## 小', '乙']);
  const deck = noteToDeck(parseNote('---\ntitle: 題\n---\n## 甲\n- a\n## 乙\n![圖](media/a.png)', { path: '10-r/b/01.md' }), { rel: '10-r/b/01.md' });
  assert.equal(deck.flash, true);
  assert.equal(deck.path, '10-r/b', '圖片路徑相對於筆記所在的資料夾');
  assert.deepEqual(deck.sections[0].slides.map(s => s.layout), ['title', 'text', 'split']);
});

test('摘錄嵌入:換成筆記的那一段;找不到就留原文並回報;程式碼裡的不動', async () => {
  const deck = { sections: [{ slides: [
    { file: 'a.md', body: '# 一\n![[筆記#重點]]\n```\n![[筆記#重點]]\n```' },
    { file: 'b.md', body: '![[沒有#x]]' },
    { file: 'c.md', body: '![圖](a.png)' },
  ] }] };
  const issues = await expandEmbeds(deck, { resolve: l => l.target === '筆記' ? { path: 'notes/x.md' } : null, readNote: async () => '# 筆記\n## 重點\n- 甲\n- 乙\n## 其他\n不要' });
  assert.equal(deck.sections[0].slides[0].body, '# 一\n- 甲\n- 乙\n```\n![[筆記#重點]]\n```');
  assert.equal(deck.sections[0].slides[1].body, '![[沒有#x]]');
  assert.equal(issues.length, 1);
});

test('升級成簡報:短筆記一章多張、長筆記依 ## 分章;產生的檔案都是合法投影片', () => {
  const short = promoteNote(parseNote('---\ntitle: 兩個渠道\ntags: [a]\n---\n# 兩個渠道\n## 一句話\n結論。\n## 理由\n- 甲\n- 乙\n\n補充說明', { path: 'x.md' }), { source: 'notes/10-r/x.md', today: '2026-11-10' });
  assert.equal(short.folder, '2026-11-10-兩個渠道');
  assert.deepEqual(Object.keys(short.files).sort(), ['01-兩個渠道/01-一句話.md', '01-兩個渠道/02-理由.md', 'deck.yml']);
  assert.match(short.files['deck.yml'], /^source: notes\/10-r\/x$/m);
  assert.match(short.files['01-兩個渠道/02-理由.md'], /^# 理由\n\n- 甲\n- 乙\n\nNote:\n補充說明\n$/);
  const long = promoteNote(parseNote('# 長\n## 甲\n### 一\na\n### 二\nb\n## 乙\nc', { path: 'y.md' }), { source: 'notes/y.md', today: '2026-11-10' });
  assert.deepEqual(Object.keys(long.files).filter(f => f !== 'deck.yml'), ['01-甲/01-一.md', '01-甲/02-二.md', '02-乙/01-乙.md']);
  for (const [f, text] of Object.entries({ ...short.files, ...long.files })) if (f.endsWith('.md')) {
    const r = parseSlideFile(text, { path: f });
    assert.deepEqual(r.issues, []);
    assert.ok(r.slides[0].notes, f + ' 要有講者備註');
  }
  assert.equal(safeName('a/b: c?'), 'a-b-c');
  assert.match(slideFromSection('題', '只有一段'), /^# 題\n\n只有一段\n\nNote:/);
});

test('升級與講後筆記的產物放回書庫後,通過檢查而且互相連得起來', async () => {
  const lib = { ...files };
  const book = promoteBook({ title: '原子習慣', notes: [parseNote(lib['notes/10-reading/2026-11-book/01-ch1.md'], { path: 'a' }), parseNote(lib['notes/10-reading/2026-11-book/02-ch2.md'], { path: 'b' })] }, { source: 'notes/10-reading/2026-11-book', today: '2026-11-10' });
  for (const [f, text] of Object.entries(book.files)) lib[`slides/10-reading/${book.folder}/${f}`] = text;
  let v = await openVault(memorySource(lib));
  const project = findDeck(v, '10-reading', book.folder);
  const note = distillDeck(await loadDeck(v.slidesSource, project), { deckPath: v.deckPath(project), today: '2026-11-11' });
  assert.match(note.text, /^from_deck: slides\/10-reading\/2026-11-10-原子習慣$/m);
  assert.match(note.text, /^public: false$/m);
  lib[`notes/10-reading/${note.file}`] = note.text;
  const report = await checkVault(memorySource(lib));
  assert.deepEqual(report.problems, []);
  assert.equal(report.kind, 'leafpile');
  v = await openVault(memorySource(lib));
  const g = await buildGraph(v);
  assert.ok(g.backlinks.get('notes/10-reading/2026-11-book/02-ch2.md').some(b => b.from.folder === book.folder));
});

test('checkVault:連結找不到與急件到期是提醒,摘錄找不到是錯誤', async () => {
  const report = await checkVault(memorySource({
    ...files,
    'notes/10-reading/pin.md': '---\npinned: true\nexpires: 2026-01-01\nlayout: split\n---\n# 急',
    'slides/10-reading/2026-11-share/01-a/02.md': '# 二\n![[不存在#x]]\n\nNote: n',
  }), null, { today: '2026-11-10' });
  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0].message, /不存在/);
  const w = report.warnings.map(x => x.message).join('\n');
  for (const re of [/\[\[不存在\]\]/, /2026-01-01/, /layout/]) assert.match(w, re);
  assert.deepEqual(report.notes, { topics: 3, notes: 6, books: 1, links: 5 });
});
