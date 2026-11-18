// Google Drive 書庫與分享連結:用一個「模擬的 Drive」(只實作 Leafpile 用到的 REST 呼叫)測試,
// 不連網路。真正的 Google 登入只能在瀏覽器裡試,這裡用假的通行證。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DriveSource, SharedSource, driveClient, findOrCreateRoot } from '../app/sources/drive.js';
import { FakeDrive } from './fake-drive.mjs';
import { sharePaths, manifestName, buildManifest, parseManifest, shareTarget, resolveRel, mediaRefs } from '../app/core/share.js';
import { openVault } from '../app/core/vault.js';
import { scaffoldFiles } from '../app/core/scaffold.js';
import { setLang } from '../app/core/i18n.js';

setLang('zh-Hant');

async function setup() {
  const drive = new FakeDrive();
  let renewed = 0;
  const auth = { token: async () => drive.token, renew: async () => { renewed++; return drive.token; } };
  const client = driveClient({ fetch: drive.fetch, auth });
  const root = await findOrCreateRoot(client);
  const src = new DriveSource(root, client);
  for (const f of scaffoldFiles('sample')) await src.writeText(f.path, f.text, { expect: null, mkdir: true });
  return { drive, client, root, src, renewed: () => renewed };
}

test('findOrCreateRoot:第一次建立,之後找到同一個', async () => {
  const drive = new FakeDrive();
  const client = driveClient({ fetch: drive.fetch, auth: { token: async () => drive.token, renew: async () => drive.token } });
  const a = await findOrCreateRoot(client), b = await findOrCreateRoot(client);
  assert.equal(a, b);
  assert.equal([...drive.files.values()].filter(f => f.name === 'Leafpile').length, 1);
});

test('起手式寫進 Drive 之後,openVault 認得出是 Leafpile 書庫', async () => {
  const { src } = await setup();
  src.refresh();
  const vault = await openVault(src);
  assert.equal(vault.kind, 'leafpile');
  assert.equal(vault.topics.find(t => t.id === '01-inbox').notes.items.length, 1);
});

test('讀寫:存檔前比對狀態,被別處改過就停下來', async () => {
  const { src, drive } = await setup();
  const p = 'notes/01-inbox/welcome.md';
  const before = await src.stat(p);
  const s2 = await src.writeText(p, '# 改過', { expect: before });
  assert.notEqual(s2, before);
  assert.equal(await src.readText(p), '# 改過');
  // 別的裝置改了同一個檔
  const f = [...drive.files.values()].find(x => x.name === 'welcome.md');
  f.content = '# 手機上改的'; f.modifiedTime = new Date(drive.at += 1000).toISOString();
  await assert.rejects(src.writeText(p, '# 電腦上改的', { expect: s2 }), /stale/);
  assert.equal(f.content, '# 手機上改的');
  await assert.rejects(src.writeText('notes/01-inbox/x.md', 'a', { expect: null }).then(() => src.writeText('notes/01-inbox/x.md', 'b', { expect: null })), /stale/);
});

test('不收書庫外、不合規的路徑', async () => {
  const { src } = await setup();
  await assert.rejects(src.writeText('../evil.md', 'x'), /bad path/);
  await assert.rejects(src.writeText('notes/a.exe', 'x'), /bad type/);
});

test('通行證過期:401 時重新取得一次再試', async () => {
  const { src, drive, renewed } = await setup();
  drive.token = 'tok-2';
  const auth = { token: async () => 'tok-1', renew: async () => 'tok-2' };
  src.client = driveClient({ fetch: drive.fetch, auth: { token: async () => auth.token(), renew: async () => { auth.token = async () => 'tok-2'; return 'tok-2'; } } });
  src.refresh();
  assert.ok((await src.list('notes')).length);
  assert.equal(renewed(), 0);
});

test('刪除 = 搬到 _archive/(改上層資料夾,不刪檔);搬移、改名', async () => {
  const { src, drive } = await setup();
  const n = drive.files.size;
  const to = await src.archiveTree('notes/01-inbox/welcome.md');
  assert.match(to, /^_archive\/notes\/01-inbox\/welcome/);
  assert.ok(await src.fileOf(to));
  assert.equal(await src.fileOf('notes/01-inbox/welcome.md'), null);
  assert.ok(drive.files.size >= n); // 沒有任何檔案被刪掉
  await src.moveTree(to, 'notes/01-inbox/welcome.md');
  await src.move('notes/01-inbox/welcome.md', 'notes/01-inbox/hello.md', '# hi');
  src.refresh();
  assert.equal(await src.readText('notes/01-inbox/hello.md'), '# hi');
  assert.equal(await src.fileOf('notes/01-inbox/welcome.md'), null);
});

test('分享筆記:公開筆記與它用到的圖片;別人用 API key 免登入讀到', async () => {
  const { src, drive } = await setup();
  await src.writeText('notes/01-inbox/pic.md', '# 有圖\n\n![a](img/a.png)\n![b](https://x.test/b.png)\n![c](../../secret.png)');
  await src.writeFile('notes/01-inbox/img/a.png', new Uint8Array([1, 2, 3]));
  await src.writeText('notes/01-inbox/private.md', '# 不分享');
  const item = { kind: 'note', path: 'notes/01-inbox/pic.md' };
  const paths = await sharePaths(src, item);
  assert.deepEqual(paths, ['notes/01-inbox/_topic.yml', 'notes/01-inbox/img/a.png', 'notes/01-inbox/pic.md']);
  const files = await src.publish(paths);
  const name = manifestName(item);
  await src.put(name, JSON.stringify(buildManifest(item, '有圖', files)));
  const [mid] = Object.values(await src.publish([name]));

  // 對方:沒有登入,只有 API key
  const pub = driveClient({ fetch: drive.fetch, apiKey: 'KEY' });
  const m = parseManifest(await (await pub.media(mid)).text());
  assert.deepEqual(shareTarget(m), { mode: 'n', args: ['01-inbox/pic.md'] });
  const shared = new SharedSource(m.files, pub, { virtual: { '_site.yml': 'leafpile: 1\ntitle: "有圖"\n' } });
  const vault = await openVault(shared);
  assert.equal(vault.kind, 'leafpile');
  assert.match(await shared.readText('notes/01-inbox/pic.md'), /有圖/);
  assert.equal(shared.canWrite, false);
  assert.equal(shared.writeText, undefined);
  // 沒分享的檔案讀不到(清單裡沒有,直接用 id 也拿不到)
  await assert.rejects(shared.readText('notes/01-inbox/private.md'), /missing/);
  const privId = (await src.fileOf('notes/01-inbox/private.md')).id;
  await assert.rejects(pub.media(privId), /missing/);

  // 停止分享:連結失效
  await src.unpublish([...Object.values(m.files), mid]);
  await assert.rejects(pub.media(mid), /missing/);
});

test('分享簡報:整個資料夾(含子資料夾的媒體),不含 _archive', async () => {
  const { src } = await setup();
  await src.writeText('slides/01-inbox/talk/deck.yml', 'title: 演講\n');
  await src.writeText('slides/01-inbox/talk/01.md', '# 一');
  await src.writeFile('slides/01-inbox/talk/media/x.png', new Uint8Array([1]));
  await src.writeText('slides/01-inbox/talk/_archive/old.md', '# 舊');
  const paths = await sharePaths(src, { kind: 'deck', path: 'slides/01-inbox/talk' });
  assert.deepEqual(paths, ['slides/01-inbox/_topic.yml', 'slides/01-inbox/talk/01.md', 'slides/01-inbox/talk/deck.yml', 'slides/01-inbox/talk/media/x.png']);
  assert.deepEqual(shareTarget({ kind: 'deck', path: 'slides/01-inbox/talk' }), { mode: 'd', args: ['01-inbox', 'talk'] });
  const files = Object.fromEntries(paths.map((p, i) => [p, `abcdefghij${i}`]));
  assert.equal(parseManifest(JSON.stringify(buildManifest({ kind: 'deck', path: 'slides/01-inbox/talk' }, '演講', files))).kind, 'deck');
});

test('分享畫布:畫布、卡片上的筆記與簡報、素材', async () => {
  const { src } = await setup();
  await src.writeText('slides/01-inbox/talk/deck.yml', 'title: 演講\n');
  await src.writeText('slides/01-inbox/talk/01.md', '# 一');
  await src.writeMedia('boards/media/abc.png', new Blob([new Uint8Array([9])]));
  await src.writeText('boards/想法.canvas', JSON.stringify({ nodes: [
    { id: '1', type: 'file', file: 'notes/01-inbox/welcome.md' },
    { id: '2', type: 'file', file: 'slides/01-inbox/talk/deck.yml' },
    { id: '3', type: 'file', file: 'boards/media/abc.png' },
    { id: '4', type: 'file', file: 'notes/../../x.md' },
    { id: '5', type: 'text', text: 'hi' },
  ], edges: [] }));
  const paths = await sharePaths(src, { kind: 'board', path: 'boards/想法.canvas' });
  assert.deepEqual(paths, ['boards/media/abc.png', 'boards/想法.canvas', 'notes/01-inbox/welcome.md', 'slides/01-inbox/talk/01.md', 'slides/01-inbox/talk/deck.yml']);
  assert.deepEqual(shareTarget({ kind: 'board', path: 'boards/想法.canvas' }), { mode: 'b', args: ['想法'] });
});

test('分享清單:同一個項目同一個檔名;格式錯誤、可疑路徑一律擋下', () => {
  const item = { kind: 'note', path: 'notes/a/b.md' };
  assert.equal(manifestName(item), manifestName({ ...item }));
  assert.notEqual(manifestName(item), manifestName({ kind: 'note', path: 'notes/a/c.md' }));
  assert.throws(() => parseManifest('nope'), /bad share/);
  assert.throws(() => parseManifest(JSON.stringify({ leafpile: 'share', kind: 'note', path: 'notes/a.md', files: {} })), /bad share/);
  const m = parseManifest(JSON.stringify({ leafpile: 'share', kind: 'note', path: 'notes/a.md', files: { 'notes/a.md': 'abcdefghij12', '../x.md': 'abcdefghij13', 'notes/b.md': 'bad id!' } }));
  assert.deepEqual(Object.keys(m.files), ['notes/a.md']);
});

test('resolveRel 與 mediaRefs', () => {
  assert.equal(resolveRel('notes/a/b.md', 'img/x.png'), 'notes/a/img/x.png');
  assert.equal(resolveRel('notes/a/b.md', '../c/y.png'), 'notes/c/y.png');
  assert.equal(resolveRel('notes/a/b.md', '../../../z.png'), null);
  assert.equal(resolveRel('notes/a/b.md', 'https://x/y.png'), null);
  assert.equal(resolveRel('notes/a/b.md', 'img/%E5%9C%96.png'), 'notes/a/img/圖.png');
  assert.deepEqual(mediaRefs('![a](x.png "t") <img src="y.jpg">'), ['x.png', 'y.jpg']);
});
