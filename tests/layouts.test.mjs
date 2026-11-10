// 3D 排列:任何張數都不能算出 NaN,且每張投影片都有位置
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, STAGE_ORDER } from '../app/player/layouts.js';

function makeDeck(n) {
  const per = 7, sections = [];
  for (let i = 0; i < n; i++) {
    const si = Math.floor(i / per);
    sections[si] ||= { slides: [] };
    sections[si].slides.push({});
  }
  const slides = sections.flatMap((s, si) => s.slides.map((_, i) => ({ sec: si, i })));
  return { slides, sections };
}

for (const [name, stage] of Object.entries(STAGES)) {
  for (const n of [1, 2, 50]) {
    test(`${name}:${n} 張`, () => {
      const { slides, sections } = makeDeck(n);
      for (const focus of [0, n - 1]) {
        const { poses, world } = stage.fn({ slides, sections, cur: slides[focus].sec, focus, vw: 1440, vh: 900 });
        assert.equal(poses.length, slides.length);
        const nums = [...poses.flatMap(p => [p.x, p.y, p.z, p.rx, p.ry, p.rz, p.s, p.o]), world.rx, world.ry, world.z, world.scale];
        assert.ok(nums.every(Number.isFinite), `${name} ${n} 張 focus=${focus} 出現 NaN`);
      }
    });
  }
}

test('牌堆輪替清單不變', () => {
  assert.deepEqual(STAGE_ORDER, ['pile', 'coverflow', 'carousel', 'helix', 'sphere']);
  assert.deepEqual(Object.keys(STAGES), ['pile', 'coverflow', 'carousel', 'helix', 'sphere', 'overview', 'side']);
});
