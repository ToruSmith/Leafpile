// 動畫守門:洗牌動畫是這個工具的核心體驗,預設行為不得被改動。
// 這個測試失敗,代表有人改了洗牌的時間或軌跡。若是刻意修改,請先取得作者同意,再更新這裡的數值。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { STAGES } from '../app/player/layouts.js';

const src = await readFile(new URL('../app/player/player.js', import.meta.url), 'utf8');

test('洗牌動畫的關鍵片段與數值未變', () => {
  for (const s of [
    "const crossing = kind === 'shuffle' && from && (from.d === 0) !== (to.d === 0);",
    'dur = 1150;',
    'delay = leaving ? leave++ * 45 : 330 + enter++ * 60;',
    "if (kind === 'shuffle') { dur = 1000; delay = 200 + Math.random() * 200; }",
    'x: (from.x + to.x) / 2 + (Math.random() - 0.5) * 260, y: (from.y + to.y) / 2 + (leaving ? -300 : 260),',
    'z: Math.max(from.z, to.z) + (leaving ? 80 : 220), rx: leaving ? 35 : -25, ry: (Math.random() - 0.5) * 50, rz: (Math.random() - 0.5) * 36, s: 1 };',
  ]) assert.ok(src.includes(s), `洗牌動畫被改動:找不到「${s}」`);
});

test('牌堆排列仍會洗牌', () => {
  assert.equal(STAGES.pile.shuffle, true);
});
