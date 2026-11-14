// 刪除 = 搬到 _archive/:路徑規則、編號、還原清單,以及整個資料夾搬移的安全規則(逐檔比對、失敗時原檔不動)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trashablePath, treePath, archivePath, trashItems } from '../app/core/trash.js';
import { HandleSource } from '../app/sources/sources.js';

test('trashablePath:只有 notes/ slides/ boards/ 底下、至少兩層', () => {
  for (const p of ['notes/a.md', 'notes/10-x/a.md', 'slides/10-x/deck', 'boards/b.canvas', 'notes/10-x']) assert.ok(trashablePath(p), p);
  for (const p of ['notes', '_archive/notes/a.md', 'a.md', 'notes/../x', 'notes//a.md', '/notes/a.md', '_site.yml', 'other/a.md']) assert.ok(!trashablePath(p), p);
});

test('treePath:搬移(含還原)多允許 _archive/', () => {
  assert.ok(treePath('_archive/notes/a.md'));
  assert.ok(!treePath('_archive'));
  assert.ok(!treePath('elsewhere/a'));
});

test('archivePath:保留原本路徑,同名加編號(檔案加在副檔名前、資料夾加在名稱後)', () => {
  assert.equal(archivePath('notes/10-x/a.md'), '_archive/notes/10-x/a.md');
  assert.equal(archivePath('notes/10-x/a.md', 2), '_archive/notes/10-x/a-2.md');
  assert.equal(archivePath('notes/a', 3, true), '_archive/notes/a-3');
  assert.equal(archivePath('slides/t/v1.2', 2, true), '_archive/slides/t/v1.2-2');
  assert.equal(archivePath('boards/我的.canvas', 2), '_archive/boards/我的-2.canvas');
});

test('trashItems:筆記、畫布、整份簡報、整個主題;一張一張封存的投影片與匯入復原不列', () => {
  const files = [
    '_archive/notes/10-x/a.md', '_archive/notes/10-x/_topic.yml',
    '_archive/boards/b.canvas',
    '_archive/slides/10-x/talk/deck.yml', '_archive/slides/10-x/talk/01/01-a.md',
    '_archive/slides/10-x/mini/01-start/01-hello.md', // 沒有 deck.yml 的簡報也算
    '_archive/slides/10-x/live/01/old.md', // 簡報還在、只封存一張投影片 → 不列
    '_archive/import-20260101/notes/z.md',
    '_archive/notes/90-gone/p.md', '_archive/notes/90-gone/q.md', '_archive/slides/90-gone/d/deck.yml',
  ];
  const items = trashItems(files, { liveTopics: new Set(['10-x']), liveDecks: new Set(['10-x/live']) });
  const brief = items.map(i => `${i.kind}:${i.label}`).sort();
  assert.deepEqual(brief, ['board:b', 'deck:10-x/mini', 'deck:10-x/talk', 'note:10-x/a.md', 'topic:notes/90-gone', 'topic:slides/90-gone']);
  const topic = items.find(i => i.label === 'notes/90-gone');
  assert.equal(topic.path, '_archive/notes/90-gone');
  assert.equal(topic.to, 'notes/90-gone');
  assert.equal(items.find(i => i.label === '10-x/talk').to, 'slides/10-x/talk');
  assert.equal(items.find(i => i.kind === 'note').to, 'notes/10-x/a.md');
});

// ---- 假的資料夾(巢狀、可遞迴移除、可模擬寫入失敗) ----
function fakeFile(bytes) { return { size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), text: async () => new TextDecoder().decode(bytes) }; }
function fakeDir(name, opts = {}) {
  const files = new Map(), dirs = new Map();
  const d = {
    kind: 'directory', name, files, dirs,
    async *entries() {
      for (const [n, b] of files) yield [n, { kind: 'file', getFile: async () => fakeFile(b) }];
      for (const [n, x] of dirs) yield [n, x];
    },
    async getDirectoryHandle(n, o) {
      if (files.has(n)) throw new Error('type mismatch');
      if (!dirs.has(n)) { if (!o?.create) throw new Error('not found'); dirs.set(n, fakeDir(n, opts)); }
      return dirs.get(n);
    },
    async getFileHandle(n, o) {
      if (dirs.has(n)) throw new Error('type mismatch');
      if (!files.has(n) && !o?.create) throw new Error('not found');
      return {
        kind: 'file', getFile: async () => fakeFile(files.get(n) ?? new Uint8Array()),
        createWritable: async () => { let buf; return { write: async v => { if (opts.failWrite?.(n)) throw new Error('disk full'); buf = v.arrayBuffer ? new Uint8Array(await v.arrayBuffer()) : new TextEncoder().encode(String(v)); }, close: async () => { files.set(n, opts.corrupt?.(n) ? new Uint8Array([0]) : buf ?? new Uint8Array()); } }; },
      };
    },
    async removeEntry(n, o) { if (dirs.has(n) && !o?.recursive && dirs.get(n).files.size + dirs.get(n).dirs.size) throw new Error('not empty'); files.delete(n); dirs.delete(n); },
    queryPermission: async () => 'granted',
  };
  return d;
}
const put = (root, path, text) => {
  const parts = path.split('/'), n = parts.pop();
  let d = root;
  for (const p of parts) { if (!d.dirs.has(p)) d.dirs.set(p, fakeDir(p)); d = d.dirs.get(p); }
  d.files.set(n, typeof text === 'string' ? new TextEncoder().encode(text) : text);
};
const has = async (src, path) => (await src.entryOf(path)) != null;

test('archiveTree:筆記搬到 _archive/,原位置沒有了,內容一致', async () => {
  const root = fakeDir('lib'); put(root, 'notes/10-x/a.md', '# 你好');
  const s = new HandleSource(root, 'x');
  assert.equal(await s.archiveTree('notes/10-x/a.md'), '_archive/notes/10-x/a.md');
  assert.ok(!(await has(s, 'notes/10-x/a.md')));
  assert.equal(await s.readText('_archive/notes/10-x/a.md'), '# 你好');
});

test('archiveTree:同名已經封存過就加編號,不覆蓋', async () => {
  const root = fakeDir('lib'); put(root, 'notes/a.md', '新'); put(root, '_archive/notes/a.md', '舊');
  const s = new HandleSource(root, 'x');
  assert.equal(await s.archiveTree('notes/a.md'), '_archive/notes/a-2.md');
  assert.equal(await s.readText('_archive/notes/a.md'), '舊');
  assert.equal(await s.readText('_archive/notes/a-2.md'), '新');
});

test('archiveTree:整個簡報資料夾(含圖片位元組、巢狀資料夾)一起搬', async () => {
  const root = fakeDir('lib'), png = new Uint8Array([137, 80, 78, 71, 0, 255, 1]);
  put(root, 'slides/10-x/talk/deck.yml', 'title: T'); put(root, 'slides/10-x/talk/01-a/01.md', '# A'); put(root, 'slides/10-x/talk/media/p.png', png);
  put(root, 'slides/10-x/other/deck.yml', 'title: O');
  const s = new HandleSource(root, 'x');
  assert.equal(await s.archiveTree('slides/10-x/talk'), '_archive/slides/10-x/talk');
  assert.ok(!(await has(s, 'slides/10-x/talk')));
  assert.ok(await has(s, 'slides/10-x/other/deck.yml'), '別的簡報不受影響');
  assert.deepEqual([...(await s.readBytes('_archive/slides/10-x/talk/media/p.png'))], [...png]);
  assert.equal(await s.readText('_archive/slides/10-x/talk/01-a/01.md'), '# A');
});

test('moveTree:還原搬回原位;原位置已有同名就拒絕、兩邊都不動', async () => {
  const root = fakeDir('lib'); put(root, 'notes/a.md', '內容');
  const s = new HandleSource(root, 'x');
  const to = await s.archiveTree('notes/a.md');
  await s.moveTree(to, 'notes/a.md');
  assert.equal(await s.readText('notes/a.md'), '內容');
  assert.ok(!(await has(s, to)));
  put(root, '_archive/notes/b.md', '舊'); put(root, 'notes/b.md', '新');
  await assert.rejects(() => s.moveTree('_archive/notes/b.md', 'notes/b.md'), /exists/);
  assert.equal(await s.readText('notes/b.md'), '新');
  assert.equal(await s.readText('_archive/notes/b.md'), '舊');
});

test('moveTree:複製寫到一半失敗 → 原本的完全沒動,剛複製的清掉', async () => {
  const root = fakeDir('lib', { failWrite: n => n === 'two.md' });
  put(root, 'slides/t/p/one.md', '1'); put(root, 'slides/t/p/two.md', '2');
  const s = new HandleSource(root, 'x');
  await assert.rejects(() => s.archiveTree('slides/t/p'), /disk full/);
  assert.equal(await s.readText('slides/t/p/one.md'), '1');
  assert.equal(await s.readText('slides/t/p/two.md'), '2');
  assert.ok(!(await has(s, '_archive/slides/t/p')));
});

test('moveTree:讀回來和原本不一致 → 停下來,原本的保留', async () => {
  const root = fakeDir('lib', { corrupt: n => n === 'a.md' && root.dirs.has('_archive') });
  put(root, 'notes/a.md', '原文');
  const s = new HandleSource(root, 'x');
  await assert.rejects(() => s.archiveTree('notes/a.md'), /verify/);
  assert.equal(await s.readText('notes/a.md'), '原文');
  assert.ok(!(await has(s, '_archive/notes/a.md')));
});

test('archiveTree / moveTree:拒絕不安全或不在範圍內的路徑', async () => {
  const root = fakeDir('lib'); put(root, 'notes/a.md', 'x'); put(root, '_site.yml', 'title: x');
  const s = new HandleSource(root, 'x');
  for (const p of ['notes', '_site.yml', '../x', 'notes/../_site.yml', '_archive/notes/a.md', 'other/a.md']) await assert.rejects(() => s.archiveTree(p), /bad path/, p);
  await assert.rejects(() => s.moveTree('notes/a.md', '../a.md'), /bad path/);
  await assert.rejects(() => s.archiveTree('notes/none.md'), /missing/);
});

test('沒有寫入權限就不動任何東西', async () => {
  const root = fakeDir('lib'); put(root, 'notes/a.md', 'x');
  root.queryPermission = async () => 'denied'; root.requestPermission = async () => 'denied';
  const s = new HandleSource(root, 'x');
  await assert.rejects(() => s.archiveTree('notes/a.md'), /denied/);
  assert.equal(await s.readText('notes/a.md'), 'x');
});
