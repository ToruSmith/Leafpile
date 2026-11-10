// 畫筆:列印用的 SVG 標記(不需要瀏覽器的部分)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inkMarkup, strokeMarkup } from '../app/player/ink.js';

test('inkMarkup:沒有畫就不輸出', () => {
  assert.equal(inkMarkup([]), '');
  assert.equal(inkMarkup(undefined), '');
});

test('strokeMarkup:畫筆是填色外框、螢光筆是折線', () => {
  const pen = strokeMarkup({ tool: 'pen', color: '#d6453d', pts: [[10, 10, 0.5], [40, 20, 0.8], [80, 25, 0.6]] });
  assert.match(pen, /class="ink-pen" fill="#d6453d" d="M[\d.,]+Q/);
  assert.match(pen, /Z"\/>$/);
  const hl = strokeMarkup({ tool: 'highlight', pts: [[0, 0], [100, 0]] });
  assert.equal(hl, '<path class="ink-hl" d="M0,0L100,0"/>');
  // 另一個視窗送來的資料:奇怪的顏色與座標一律清掉
  const bad = strokeMarkup({ tool: 'pen', color: '"><script>', pts: [['1"><b>', 2, 0.5], [3, 4, 9]] });
  assert.doesNotMatch(bad, /<script|<b>/);
  assert.match(bad, /fill="#d6453d"/);
  const svg = inkMarkup([{ tool: 'pen', color: '#000', pts: [[5, 5, 0.6]] }]);
  assert.match(svg, /^<svg class="ink ink-print" viewBox="0 0 1280 720"/);
});
