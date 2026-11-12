import test from 'node:test';
import assert from 'node:assert/strict';
import { SCALES, DEFAULT_SCALE, pct, parseScale, stepScale } from '../app/core/scale.js';

test('字級:0.8 到 2.2 倍,十級,由小到大', () => {
  assert.equal(SCALES.length, 10);
  assert.equal(SCALES[0], 0.8);
  assert.equal(SCALES.at(-1), 2.2);
  assert.deepEqual([...SCALES].sort((a, b) => a - b), SCALES);
  assert.ok(SCALES.includes(DEFAULT_SCALE));
});

test('字級:舊版存的值升級後還認得', () => {
  for (const old of [0.9, 1, 1.12, 1.25, 1.4]) assert.equal(parseScale(String(old)), old);
});

test('字級:壞資料回到預設', () => {
  for (const bad of [null, '', 'abc', '3', '0', '1.13', undefined]) assert.equal(parseScale(bad), DEFAULT_SCALE);
});

test('字級:一級一級走,到頭就停,0 回到預設', () => {
  assert.equal(stepScale(1, 1), 1.12);
  assert.equal(stepScale(1, -1), 0.9);
  assert.equal(stepScale(2.2, 1), 2.2);
  assert.equal(stepScale(0.8, -1), 0.8);
  assert.equal(stepScale(1.8, 0), 1);
  assert.equal(stepScale(1.13, 1), 1.12, '不在清單裡的值當成預設再走一級');
  let v = DEFAULT_SCALE, n = 0;
  while (stepScale(v, 1) !== v) { v = stepScale(v, 1); n++; }
  assert.equal(v, 2.2);
  assert.equal(n, 7);
});

test('字級:顯示成百分比', () => {
  assert.equal(pct(1), '100%');
  assert.equal(pct(1.12), '112%');
  assert.equal(pct(2.2), '220%');
});
