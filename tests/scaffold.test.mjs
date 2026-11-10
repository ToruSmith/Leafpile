// scripts/new-deck.mjs:產生的骨架要能通過檢查,也不能覆蓋既有資料夾。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/new-deck.mjs', import.meta.url));
const run = (...args) => execFileSync(process.execPath, [script, ...args, '--lang', 'en'], { encoding: 'utf8' });

for (const [name, lang, first] of [['2026-11-季報', 'zh-Hant', '01-開場'], ['03-Team-update', 'en', '01-Opening']]) {
  test(`new-deck:${lang} 骨架通過檢查`, async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'leafpile-')), name);
    const out = run(dir);
    assert.match(out, /No problems found/);
    assert.match(await readFile(join(dir, 'deck.yml'), 'utf8'), new RegExp(`lang: ${lang}`));
    assert.ok((await readdir(dir)).includes(first));
  });
}

test('new-deck:資料夾已有檔案就停止', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'leafpile-'));
  await mkdir(join(dir, 'x'));
  await writeFile(join(dir, 'x', 'a.md'), '# keep');
  assert.throws(() => run(join(dir, 'x')));
  assert.equal(await readFile(join(dir, 'x', 'a.md'), 'utf8'), '# keep');
});

test('build-starter:範例書庫是合法的 Leafpile 書庫,含檢查工具與說明,不含官方範例,且通過檢查', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const out = join(await mkdtemp(join(tmpdir(), 'leafpile-')), 'lib');
  execFileSync(process.execPath, ['scripts/build-starter.mjs', out], { cwd: root });
  const names = await readdir(out);
  for (const n of ['README.md', '_site.yml', 'leafpile-check.mjs', 'check-library.cmd', 'notes', 'slides', '_docs']) assert.ok(names.includes(n), n);
  for (const ch of ['notes', 'slides']) {
    const topics = await readdir(join(out, ch));
    assert.ok(!topics.some(n => n.startsWith('00-')), `${ch} 不含官方範例`);
    assert.ok(topics.includes('10-reading'), `${ch}/10-reading`);
  }
  assert.ok((await readdir(join(out, 'notes'))).includes('50-life'));
  for (const n of ['SPEC.md', 'INTEROP.md', 'AI_PROMPTS.md', 'slides']) assert.ok((await readdir(join(out, '_docs'))).includes(n), `_docs/${n}`);
  // 說明文件裡不能有跳出書庫的相對連結
  for (const f of ['SPEC.md', 'INTEROP.md', 'slides/GUIDE.zh-Hant.md', 'slides/MANUAL.zh-Hant.md', 'slides/MANUAL.en.md']) {
    const text = (await readFile(join(out, '_docs', f), 'utf8')).replace(/```[\s\S]*?```/g, '');
    const depth = f.split('/').length - 1;
    for (const m of text.matchAll(/\]\(((?:\.\.\/)+)/g)) assert.ok(m[1].length / 3 <= depth, `${f} 有跳出 _docs/ 的連結:${m[0]}`);
  }
  const report = execFileSync(process.execPath, [join(out, 'leafpile-check.mjs'), out, '--lang', 'en'], { encoding: 'utf8' });
  assert.match(report, /Leafpile library/);
  assert.match(report, /No problems found/);
});
