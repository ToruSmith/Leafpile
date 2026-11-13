// 書庫包:匯出時公開包不洩漏私人內容、AI 給的文字書庫包解析得出來、匯入絕不覆蓋既有檔案。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memorySource } from './helpers.mjs';
import { openVault } from '../app/core/vault.js';
import { buildGraph } from '../app/core/graph.js';
import { skipReason, walkFiles, exportPlan, parsePackText, packText, normalizeIncoming, planImport } from '../app/core/pack.js';

const LIB = {
  '_site.yml': 'leafpile: 1\ntitle: 我的書庫\ncategories:\n  - id: learning\n    name: 學習\n',
  'README.md': '# readme',
  'leafpile-check.mjs': '//',
  'notes/10-reading/_topic.yml': 'name: 讀書\ncategory: learning\npublic: true\n',
  'notes/10-reading/2026-11-book/_book.yml': 'title: 一本書\n',
  'notes/10-reading/2026-11-book/01-a.md': '---\ntitle: 甲\n---\n# 甲\n\n![](media/cover.png)\n',
  'notes/10-reading/2026-11-book/media/cover.png': 'PNG',
  'notes/10-reading/2026-11-book/media/secret.png': 'PNG2',
  'notes/10-reading/secret.md': '---\ntitle: 秘密\npublic: false\n---\n# 秘密\n',
  'notes/20-work/_topic.yml': 'name: 工作\n',
  'notes/20-work/2026-11-diary/_book.yml': 'title: 日記\n',
  'notes/20-work/2026-11-diary/01.md': '# 私人日記\n',
  'notes/30-local/_topic.yml': 'name: 本機\npublic: true\nlocal_only: true\n',
  'notes/30-local/x.md': '# 本機\n',
  'slides/10-reading/2026-11-share/deck.yml': 'title: 分享\n',
  'slides/10-reading/2026-11-share/01-x.md': '# x\n',
  'slides/20-work/2026-11-report/deck.yml': 'title: 報告\n',
  'slides/20-work/2026-11-report/01-y.md': '# y\n',
  'boards/map.canvas': '{"nodes":[],"edges":[]}',
  '_archive/notes/old.md': '# old',
};

test('pack:書庫包只收書庫的部分;工具檔、_archive、其他類型略過', () => {
  assert.equal(skipReason('notes/a.md'), '');
  assert.equal(skipReason('_site.yml'), '');
  assert.equal(skipReason('boards/media/a.png'), '');
  assert.equal(skipReason('README.md'), 'tool');
  assert.equal(skipReason('_archive/notes/a.md'), 'archive');
  assert.equal(skipReason('notes/x/run.exe'), 'type');
  assert.equal(skipReason('other/a.md'), 'outside');
  assert.equal(skipReason('notes.md'), 'outside');
});

test('pack:匯出整個書庫', async () => {
  const src = memorySource(LIB);
  const paths = await walkFiles(src);
  assert.ok(!paths.some(p => p.startsWith('_archive')), 'walkFiles 不走 _archive');
  const { include } = exportPlan(paths, { vault: null, graph: null });
  assert.ok(include.includes('boards/map.canvas') && include.includes('notes/10-reading/secret.md'));
  assert.ok(!include.includes('README.md') && !include.includes('leafpile-check.mjs'));
});

test('pack:公開包不帶出私人筆記、私人主題的簡報、local_only、畫布與沒被公開筆記提到的圖片', async () => {
  const src = memorySource(LIB);
  const vault = await openVault(src);
  const graph = await buildGraph(vault);
  const { include, skipped } = exportPlan(await walkFiles(src), { vault, graph, publicOnly: true });
  const set = new Set(include);
  for (const p of ['_site.yml', 'notes/10-reading/_topic.yml', 'notes/10-reading/2026-11-book/_book.yml', 'notes/10-reading/2026-11-book/01-a.md',
    'notes/10-reading/2026-11-book/media/cover.png', 'slides/10-reading/2026-11-share/deck.yml', 'slides/10-reading/2026-11-share/01-x.md']) assert.ok(set.has(p), '應該包含 ' + p);
  for (const p of ['notes/10-reading/secret.md', 'notes/10-reading/2026-11-book/media/secret.png', 'notes/20-work/_topic.yml', 'notes/20-work/2026-11-diary/_book.yml',
    'notes/20-work/2026-11-diary/01.md', 'notes/30-local/x.md', 'notes/30-local/_topic.yml', 'slides/20-work/2026-11-report/deck.yml', 'boards/map.canvas']) assert.ok(!set.has(p), '不該包含 ' + p);
  assert.ok(skipped.some(s => s.path === 'notes/10-reading/secret.md' && s.reason === 'private'));
});

test('pack:文字書庫包,容忍前後說明、``` 包裝、Windows 換行、少了最後的 END', () => {
  const text = '好的,以下是書庫包:\r\n\r\n=== FILE: notes/10-reading/a.md ===\r\n```markdown\r\n# 甲\r\n\r\n內文\r\n```\r\n=== END ===\r\n\r\n=== FILE: `notes/10-reading/_topic.yml` ===\nname: 讀書\n=== END ===\n=== FILE: ./notes/10-reading/b.md ===\n# 乙\n\n```js\ncode\n```\n';
  const files = parsePackText(text);
  assert.deepEqual(files.map(f => f.path), ['notes/10-reading/a.md', 'notes/10-reading/_topic.yml', 'notes/10-reading/b.md']);
  assert.equal(files[0].data, '# 甲\n\n內文\n');
  assert.equal(files[1].data, 'name: 讀書\n');
  assert.match(files[2].data, /```js\ncode\n```\n$/, '筆記裡真正的程式碼區塊要保留');
  assert.deepEqual(parsePackText(packText(files)), files, '寫出再讀回要一樣');
  assert.deepEqual(parsePackText('沒有任何檔案'), []);
});

test('pack:zip 外層多包一層資料夾時去掉', () => {
  assert.deepEqual(normalizeIncoming([{ path: 'leafpile-library/notes/a.md', data: '' }, { path: 'leafpile-library/_site.yml', data: '' }]).map(f => f.path), ['notes/a.md', '_site.yml']);
  assert.deepEqual(normalizeIncoming([{ path: 'notes/a.md', data: '' }, { path: 'notes/b.md', data: '' }]).map(f => f.path), ['notes/a.md', 'notes/b.md'], '本來就是 notes/ 開頭的不要動');
});

const targetOf = files => ({ exists: async p => p in files, read: async p => files[p] });

test('pack:匯入規劃:新增、相同略過、不同改名、設定檔保留、分類合併、工具檔略過', async () => {
  const mine = {
    '_site.yml': 'leafpile: 1\ntitle: 我的\ncategories: # 分類\n  - id: learning\n    name: 學習\n',
    'notes/10-reading/_topic.yml': 'name: 讀書\npublic: true\n',
    'notes/10-reading/a.md': '# 甲\n',
    'notes/10-reading/b.md': '# 乙(我的版本)\n',
    'notes/10-reading/b-2.md': '# 已經有 b-2\n',
    'boards/media/x.png': new Uint8Array([1, 2, 3]),
  };
  const { items, counts } = await planImport([
    { path: '_site.yml', data: 'leafpile: 1\ntitle: AI 的\ncategories:\n  - id: learning\n    name: 學習(別名)\n  - id: health\n    name: 健康\n' },
    { path: 'notes/10-reading/_topic.yml', data: 'name: 閱讀\n' },
    { path: 'notes/10-reading/a.md', data: '# 甲\r\n' },
    { path: 'notes/10-reading/b.md', data: '# 乙(AI 版本)\n' },
    { path: 'notes/10-reading/c.md', data: '# 丙\n' },
    { path: 'notes/10-reading/c.md', data: '# 丙又一次\n' },
    { path: 'boards/media/x.png', data: new Uint8Array([1, 2, 3]) },
    { path: 'README.md', data: '# r' },
    { path: 'notes/x/evil.js', data: 'x' },
  ], targetOf(mine));
  const by = p => items.find(i => i.from === p && i.action !== 'skip') || items.find(i => i.from === p);
  assert.equal(by('notes/10-reading/a.md').action, 'same', '只差換行符號也算相同');
  assert.deepEqual([by('notes/10-reading/b.md').action, by('notes/10-reading/b.md').path], ['rename', 'notes/10-reading/b-3.md'], 'b-2 已經有了,要用 b-3');
  assert.equal(by('notes/10-reading/_topic.yml').action, 'keep');
  assert.equal(by('notes/10-reading/c.md').action, 'add');
  assert.equal(items.filter(i => i.from === 'notes/10-reading/c.md' && i.action === 'skip')[0].reason, 'duplicate');
  assert.equal(by('boards/media/x.png').action, 'same');
  assert.equal(by('README.md').reason, 'tool');
  assert.equal(by('notes/x/evil.js').reason, 'type');
  const site = by('_site.yml');
  assert.equal(site.action, 'merge');
  assert.deepEqual(site.added, ['健康']);
  assert.match(site.data, /title: 我的/, '標題保留原本的');
  assert.match(site.data, /name: 學習\n/, '原有分類的名稱不變');
  assert.match(site.data, /id: health/);
  assert.ok(counts.add >= 1 && counts.rename === 1);
});

test('pack:同名簡報內容不同時,整份簡報換資料夾,不跟原本的混在一起', async () => {
  const mine = { 'slides/10-r/2026-11-x/deck.yml': 'title: 我的\n', 'slides/10-r/2026-11-x/01-a.md': '# a\n', 'slides/10-r/2026-11-x-2/deck.yml': 'title: 已經有 -2\n' };
  const { items } = await planImport([
    { path: 'slides/10-r/2026-11-x/deck.yml', data: 'title: AI 的\n' },
    { path: 'slides/10-r/2026-11-x/01-a.md', data: '# 不一樣\n' },
    { path: 'slides/10-r/2026-11-x/02-b.md', data: '# b\n' },
  ], targetOf(mine));
  assert.deepEqual(items.map(i => [i.action, i.path]), [
    ['add', 'slides/10-r/2026-11-x-3/deck.yml'], ['add', 'slides/10-r/2026-11-x-3/01-a.md'], ['add', 'slides/10-r/2026-11-x-3/02-b.md'],
  ]);
});
