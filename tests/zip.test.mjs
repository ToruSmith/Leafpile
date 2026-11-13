// zip 讀寫:往返一致、中文檔名、壓縮、與 Python 產生的 zip 互通、擋掉危險路徑與過大的檔案。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZip, readZip, safeZipPath, crc32 } from '../app/core/zip.js';

const text = new TextDecoder();

test('zip:寫出再讀回,內容與中文檔名不變;長文字會壓縮', async () => {
  const long = '筆記'.repeat(500);
  const z = await writeZip([
    { path: 'notes/10-讀書/01-第一章.md', data: long },
    { path: '_site.yml', data: 'title: 測試\n' },
    { path: 'boards/media/a.png', data: new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3]) },
  ]);
  assert.ok(z.length < long.length * 3, '長文字應該有壓縮');
  const { files, skipped } = await readZip(z);
  assert.deepEqual(skipped, []);
  assert.deepEqual(files.map(f => f.path), ['notes/10-讀書/01-第一章.md', '_site.yml', 'boards/media/a.png']);
  assert.equal(text.decode(files[0].data), long);
  assert.deepEqual([...files[2].data], [137, 80, 78, 71, 0, 1, 2, 3]);
});

test('zip:讀得懂其他工具(Python zipfile)產生的 zip,也產生得出其他工具讀得懂的 zip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lpzip-'));
  mkdirSync(join(dir, 'lib/notes'), { recursive: true });
  writeFileSync(join(dir, 'lib/notes/甲.md'), '# 甲\n'.repeat(50));
  writeFileSync(join(dir, 'lib/.DS_Store'), 'x');
  execFileSync('python3', ['-c', `import zipfile,os
z=zipfile.ZipFile('${dir}/py.zip','w',zipfile.ZIP_DEFLATED)
for r,_,fs in os.walk('${dir}/lib'):
  for f in fs: z.write(os.path.join(r,f), os.path.relpath(os.path.join(r,f), '${dir}'))
z.close()`]);
  const { files } = await readZip(readFileSync(join(dir, 'py.zip')));
  assert.deepEqual(files.map(f => f.path), ['lib/notes/甲.md'], '.DS_Store 要略過');
  assert.equal(text.decode(files[0].data), '# 甲\n'.repeat(50));
  writeFileSync(join(dir, 'ours.zip'), await writeZip([{ path: 'notes/乙.md', data: '# 乙\n'.repeat(80) }]));
  const out = execFileSync('python3', ['-c', `import zipfile;z=zipfile.ZipFile('${dir}/ours.zip');print(z.testzip());print(z.read('notes/乙.md').decode()[:4])`]).toString();
  assert.match(out, /^None\n# 乙/);
});

test('zip:擋掉跳出資料夾的路徑與隱藏檔', () => {
  for (const bad of ['../x.md', 'a/../../x.md', '/etc/passwd', 'C:/x.md', 'a\\b.md', '.git/config', '__MACOSX/a', 'a/.hidden']) assert.equal(safeZipPath(bad), null, bad);
  assert.equal(safeZipPath('notes//a.md'), 'notes/a.md');
});

test('zip:過大的檔案略過、總量超過上限就停止(防解壓縮炸彈)', async () => {
  const z = await writeZip([{ path: 'a.md', data: 'x'.repeat(5000) }, { path: 'b.md', data: 'ok' }]);
  const r = await readZip(z, { files: 10, fileBytes: 1000, totalBytes: 1e6 });
  assert.deepEqual(r.files.map(f => f.path), ['b.md']);
  assert.deepEqual(r.skipped, [{ path: 'a.md', reason: 'size' }]);
  await assert.rejects(() => readZip(z, { files: 10, fileBytes: 1e6, totalBytes: 100 }), /too large/);
  await assert.rejects(() => readZip(new Uint8Array([1, 2, 3])), /not a zip/);
});

test('zip:crc32 與標準值一致', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});
