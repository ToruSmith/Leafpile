// 發布前檢查與訪客視角的純邏輯。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memorySource } from './helpers.mjs';
import { openVault, notesOfTopic } from '../app/core/vault.js';
import { scanPIIAll, maskPII, auditPrivacy, visitorVault } from '../app/core/privacy.js';

test('scanPIIAll:每一筆都列出、有行號;程式碼與範例網域不算;同一筆只報一次', () => {
  const text = '聯絡 a.b@gmail.com 或 0912-345-678\n`c@gmail.com`\n```\nd@gmail.com\n```\nx@example.com y@foo.test\nA123456789 再一次 a.b@gmail.com\n編號 B12345678901 不是身分證';
  assert.deepEqual(scanPIIAll(text), [
    { key: 'email', match: 'a.b@gmail.com', line: 1 },
    { key: 'phone', match: '0912-345-678', line: 1 },
    { key: 'tw-id', match: 'A123456789', line: 7 },
  ]);
});

test('maskPII:螢幕上只露頭尾', () => {
  assert.equal(maskPII('email', 'alice@gmail.com'), 'a****@gmail.com');
  assert.equal(maskPII('phone', '0912-345-678'), '091*-***-678');
  assert.equal(maskPII('tw-id', 'A123456789'), 'A1******89');
});

test('auditPrivacy:統計公開/私人/只留本機;個資依「會公開」排前面;不回傳全文', () => {
  const r = auditPrivacy([
    { rel: 'a.md', title: 'A', text: 'x@gmail.com', public: false, localOnly: false },
    { rel: 'b.md', title: 'B', text: '0912345678', public: true, localOnly: false },
    { rel: 'c.md', title: 'C', text: 'A123456789', public: true, localOnly: true },
    { rel: 'd.md', title: 'D', text: '乾淨', public: true, localOnly: false },
    { rel: 'slides/x/01.md', title: 'X', text: 'y@gmail.com', public: false, localOnly: false, kind: 'slide' },
  ]);
  assert.deepEqual(r.counts, { public: 2, private: 1, localOnly: 1 });
  assert.deepEqual(r.publicNotes.map(n => n.rel), ['b.md', 'd.md']);
  assert.deepEqual(r.pii.map(p => [p.rel, p.exposed]), [['b.md', true], ['slides/x/01.md', true], ['a.md', false], ['c.md', false]]);
  assert.ok(!('text' in r.pii[0]));
});

test('visitorVault:只留公開筆記、空筆記本拿掉、只留本機主題的簡報拿掉;原書庫不變', async () => {
  const v = await openVault(memorySource({
    'notes/10-reading/pub.md': '# P', 'notes/10-reading/priv.md': '# Q',
    'notes/10-reading/book/01.md': '# B1', 'notes/10-reading/book/_book.yml': 'title: 書\n',
    'notes/50-life/_topic.yml': 'local_only: true\n', 'notes/50-life/diary.md': '# D',
    'slides/10-reading/talk/deck.yml': 'title: 分享\n', 'slides/10-reading/talk/01.md': '# 1',
    'slides/50-life/trip/deck.yml': 'title: 旅行\n', 'slides/50-life/trip/01.md': '# 1',
  }));
  const vv = visitorVault(v, rel => rel === '10-reading/pub.md');
  const reading = vv.topics.find(tp => tp.id === '10-reading'), life = vv.topics.find(tp => tp.id === '50-life');
  assert.deepEqual(notesOfTopic(reading.notes).map(n => n.path), ['10-reading/pub.md']);
  assert.equal(reading.notes.items.filter(i => i.kind === 'book').length, 0);
  assert.equal(reading.decks.length, 1);
  assert.equal(life.decks.length, 0);
  assert.equal(notesOfTopic(life.notes).length, 0);
  assert.equal(notesOfTopic(v.topics.find(tp => tp.id === '10-reading').notes).length, 3); // 原書庫不受影響
  for (const c of vv.categories) for (const tp of c.topics) assert.ok(vv.topics.includes(tp));
});
