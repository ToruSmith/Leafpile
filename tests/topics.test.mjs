// 主題管理(設定類)的規則與預覽。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseYaml } from '../app/core/yaml.js';
import { topicIdError, suggestTopicPrefix, newTopicYaml, planTopicEdit, planCategories, categoryIdError, validColor, topicConfPath } from '../app/core/topics.js';

const TOPIC = readFileSync(new URL('../content/notes/40-reference/_topic.yml', import.meta.url), 'utf8');
const SITE = readFileSync(new URL('../content/_site.yml', import.meta.url), 'utf8');

test('topicIdError:資料夾名稱的規則', () => {
  const ids = ['10-reading', '20-work'];
  assert.equal(topicIdError('60-health', ids), null);
  assert.equal(topicIdError('60-健康', ids), null, '可以用中文');
  assert.equal(topicIdError('', ids), 'empty');
  assert.equal(topicIdError(' 60-x', ids), 'spaces');
  assert.equal(topicIdError('a/b', ids), 'chars');
  assert.equal(topicIdError('a:b', ids), 'chars');
  assert.equal(topicIdError('x.', ids), 'chars');
  assert.equal(topicIdError('_archive', ids), 'reserved');
  assert.equal(topicIdError('.hidden', ids), 'reserved');
  assert.equal(topicIdError('10-Reading', ids), 'exists', '不分大小寫');
  assert.equal(topicIdError('x'.repeat(81), ids), 'long');
});

test('suggestTopicPrefix:最大的數字前綴再加 10', () => {
  assert.equal(suggestTopicPrefix(['00-examples', '10-reading', '50-life']), '60-');
  assert.equal(suggestTopicPrefix(['00-a', '11-b', '21-c']), '30-');
  assert.equal(suggestTopicPrefix(['reading']), '10-');
  assert.equal(suggestTopicPrefix([]), '10-');
  assert.equal(suggestTopicPrefix(['090-a']), '100-');
});

test('newTopicYaml:只寫有填的欄位,讀得回來', () => {
  assert.deepEqual(parseYaml(newTopicYaml({ name: '健康', category: 'life', color: '#2a7f62' })), { name: '健康', category: 'life', color: '#2a7f62' });
  assert.equal(newTopicYaml({ name: '健康' }), 'name: 健康\n');
  assert.equal(topicConfPath('60-health'), 'notes/60-health/_topic.yml');
});

test('planTopicEdit:只改不同的鍵,保留註解,列出改了什麼', () => {
  const { text, changes } = planTopicEdit(TOPIC, { name: '速查與模板', description: '速查表、清單、可重複使用的模板。', category: 'learning', color: '#7a5fa0', public: true }, '40-reference');
  assert.deepEqual(changes, [{ key: 'category', from: 'reference', to: 'learning' }]);
  assert.equal(text, TOPIC.replace('category: reference', 'category: learning'));
  assert.ok(text.includes('# 這個主題的筆記沒寫 public 時的預設值'));
});

test('planTopicEdit:公開設定改成不設定 = 拿掉那一行;沒變就沒有改動', () => {
  const r = planTopicEdit(TOPIC, { ...parseYaml(TOPIC), public: '' }, '40-reference');
  assert.deepEqual(r.changes, [{ key: 'public', from: true, to: '' }]);
  assert.ok(!/public/.test(r.text));
  const same = planTopicEdit(TOPIC, { ...parseYaml(TOPIC) }, '40-reference');
  assert.deepEqual(same.changes, []);
  assert.equal(same.text, TOPIC);
});

test('planTopicEdit:沒有設定檔時,只寫有改的;名稱和資料夾預設一樣就不寫', () => {
  const r = planTopicEdit('', { name: 'reading', description: '', category: 'learning', color: '', public: '' }, '10-reading');
  assert.deepEqual(r.changes, [{ key: 'category', from: '', to: 'learning' }]);
  assert.equal(r.text, 'category: learning\n');
  const r2 = planTopicEdit('', { name: '讀書筆記', description: '', category: '', color: '', public: false }, '10-reading');
  assert.deepEqual(parseYaml(r2.text), { name: '讀書筆記', public: false });
});

test('planTopicEdit:原檔用 title 時改 title,不另外加 name', () => {
  const r = planTopicEdit('title: 舊名\n', { name: '新名', description: '', category: '', color: '', public: '' }, 'x');
  assert.equal(r.text, 'title: 新名\n');
  assert.deepEqual(r.changes, [{ key: 'title', from: '舊名', to: '新名' }]);
});

const cats = () => parseYaml(SITE).categories.map(c => ({ id: c.id, name: c.name, color: c.color }));
const topics = [{ title: '讀書筆記', category: 'learning' }, { title: '收件匣', category: 'inbox' }];

test('planCategories:改名、改色、調順序、新增,列出改動,其他段落不動', () => {
  const next = cats();
  next[0].name = '示範';
  [next[1], next[2]] = [next[2], next[1]];
  next.push({ id: 'health', name: '健康', color: '#2a7f62' });
  const r = planCategories(SITE, next, topics);
  assert.deepEqual(r.changes.map(c => c.type), ['rename', 'add', 'order']);
  assert.deepEqual(r.blocked, []);
  const back = parseYaml(r.text);
  assert.deepEqual(back.categories.map(c => c.id), ['examples', 'learning', 'inbox', 'work', 'finance', 'reference', 'life', 'health']);
  assert.equal(back.categories[0].name, '示範');
  assert.deepEqual(back.limits, parseYaml(SITE).limits);
  assert.ok(r.text.includes('# GitHub 守門上限'));
});

test('planCategories:還有主題在用的分類不能刪;沒人用的可以', () => {
  const r = planCategories(SITE, cats().filter(c => c.id !== 'learning' && c.id !== 'life'), topics);
  assert.deepEqual(r.blocked, [{ id: 'learning', topics: ['讀書筆記'] }]);
  assert.ok(r.changes.some(c => c.type === 'remove' && c.id === 'life'));
  const none = planCategories(SITE, cats(), topics);
  assert.deepEqual(none.changes, []);
  assert.equal(none.text, SITE, '沒改就不動檔案');
});

test('planCategories:沒有 _site.yml 時新建 categories', () => {
  const r = planCategories('', [{ id: 'a', name: '甲', color: '' }]);
  assert.deepEqual(parseYaml(r.text), { categories: [{ id: 'a', name: '甲' }] });
});

test('categoryIdError / validColor', () => {
  assert.equal(categoryIdError('health', ['life']), null);
  assert.equal(categoryIdError('', []), 'empty');
  assert.equal(categoryIdError('健康', []), 'chars');
  assert.equal(categoryIdError('life', ['life']), 'exists');
  assert.ok(validColor('#2a7f62') && validColor('#abc') && validColor(''));
  assert.ok(!validColor('red') && !validColor('#12345'));
});
