// 設定檔的局部改寫:只動要改的行,保留註解與順序,改完還讀得回來。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseYaml } from '../app/core/yaml.js';
import { yamlScalar, setTopKey, setTopKeys, findBlock, replaceBlock, blockComments, categoriesYaml } from '../app/core/yaml-edit.js';

test('yamlScalar:需要時才加引號,讀回來的值一樣', () => {
  const cases = ['讀書筆記', 'plain text', '#4f73a6', 'true', 'no', '123', '1.5', '- dash', 'a: b', 'x # y', '', ' 前後空白 ', '引號"在裡面', "it's", '[x]', '{x}', 'C:\\path', 'a \\ "b"', 'x\\"y', '2026-11-12', '@me', '*star'];
  for (const v of cases) {
    const back = parseYaml(`k: ${yamlScalar(v)}\n`).k;
    assert.equal(String(back), v, `字串 ${JSON.stringify(v)} → ${yamlScalar(v)} → ${JSON.stringify(back)}`);
  }
  assert.equal(yamlScalar('讀書筆記'), '讀書筆記');
  assert.equal(yamlScalar('第一行\n第二行\t尾'), '第一行 第二行 尾', '換行與 tab 換成空白');
  assert.equal(yamlScalar('#4f73a6'), '"#4f73a6"');
  assert.equal(yamlScalar(true), 'true');
  assert.equal(yamlScalar(false), 'false');
});

const TOPIC = `name: 速查與模板
description: 速查表、清單、可重複使用的模板。
category: reference
color: "#7a5fa0"
public: true  # 這個主題的筆記沒寫 public 時的預設值
`;

test('setTopKey:只改那一行,保留行尾註解與其他行', () => {
  const out = setTopKey(TOPIC, 'public', false);
  assert.equal(out, TOPIC.replace('public: true  #', 'public: false  #'));
  const out2 = setTopKey(TOPIC, 'category', 'learning');
  assert.deepEqual(out2.split('\n').filter((l, i) => l !== TOPIC.split('\n')[i]), ['category: learning']);
  assert.equal(parseYaml(out2).category, 'learning');
});

test('setTopKey:不存在就加在最後,null 就拿掉', () => {
  const add = setTopKey(TOPIC, 'local_only', true);
  assert.ok(add.endsWith('local_only: true\n'));
  assert.equal(parseYaml(add).local_only, true);
  const rm = setTopKey(TOPIC, 'color', null);
  assert.ok(!/color/.test(rm));
  assert.equal(rm.split('\n').length, TOPIC.split('\n').length - 1);
  assert.equal(setTopKey(TOPIC, 'nope', null), TOPIC, '拿掉不存在的鍵:不變');
  assert.equal(setTopKey('', 'name', '新主題'), 'name: 新主題\n', '空檔案');
});

test('setTopKey:原本寫成多行(區塊)的值整段換掉,不留殘行', () => {
  const t = 'name: A\ndescription: |\n  第一行\n  第二行\n\ncolor: "#123456"\n';
  const out = setTopKey(t, 'description', '一行就好');
  assert.equal(out, 'name: A\ndescription: 一行就好\n\ncolor: "#123456"\n');
  assert.deepEqual(parseYaml(out), { name: 'A', description: '一行就好', color: '#123456' });
});

test('setTopKey:不會改到縮排裡同名的鍵', () => {
  const t = 'categories:\n  - id: a\n    name: 舊\nname: 書庫\n';
  const out = setTopKey(t, 'name', '新書庫');
  assert.equal(out, 'categories:\n  - id: a\n    name: 舊\nname: 新書庫\n');
});

test('setTopKeys:一次改好幾個,讀回來正確', () => {
  const out = setTopKeys(TOPIC, { name: '參考資料', category: 'learning', color: '#123abc', public: undefined });
  assert.deepEqual(parseYaml(out), { name: '參考資料', description: '速查表、清單、可重複使用的模板。', category: 'learning', color: '#123abc' });
});

const SITE = readFileSync(new URL('../content/_site.yml', import.meta.url), 'utf8');

test('findBlock:清單區塊不含後面那段的註解與空行', () => {
  const lines = SITE.split('\n');
  const [s, e] = findBlock(lines, 'categories');
  assert.equal(lines[s], 'categories:');
  assert.match(lines[e - 1], /color:/);
  assert.ok(!lines.slice(s, e).some(l => /守門/.test(l)), '下一段的註解不算');
  const withInner = 'categories:\n  - id: a\n# 中間的註解\n  - id: b\nlimits:\n  x: 1\n';
  const l2 = withInner.split('\n');
  assert.deepEqual(findBlock(l2, 'categories'), [0, 4], '區塊中間頂格的註解算在區塊裡');
});

test('replaceBlock + categoriesYaml:只換 categories,其他段落與註解原封不動', () => {
  const cats = parseYaml(SITE).categories;
  const next = [cats[2], cats[0], ...cats.slice(3), { id: 'health', name: '健康', color: '#2a7f62' }];
  const out = replaceBlock(SITE, 'categories', categoriesYaml(next));
  const back = parseYaml(out);
  assert.deepEqual(back.categories.map(c => c.id), ['learning', 'examples', 'work', 'finance', 'reference', 'life', 'health']);
  assert.equal(back.title, parseYaml(SITE).title);
  assert.deepEqual(back.limits, parseYaml(SITE).limits);
  for (const keep of ['# Leafpile 書庫設定', '# 分類：主題用 category', '# GitHub 守門上限']) assert.ok(out.includes(keep), `保留註解:${keep}`);
  assert.equal(blockComments(SITE, 'categories'), 0);
  assert.equal(blockComments('categories:\n  - id: a  # 註解\n', 'categories'), 1);
});

test('replaceBlock:沒有 categories 就加在最後', () => {
  const out = replaceBlock('title: 我的書庫\n', 'categories', categoriesYaml([{ id: 'a', name: '甲' }]));
  assert.deepEqual(parseYaml(out), { title: '我的書庫', categories: [{ id: 'a', name: '甲' }] });
  assert.deepEqual(parseYaml(replaceBlock('', 'categories', categoriesYaml([{ id: 'a', name: '甲', color: '#111111' }]))), { categories: [{ id: 'a', name: '甲', color: '#111111' }] });
});
