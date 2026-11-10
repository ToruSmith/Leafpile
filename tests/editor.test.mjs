// 編輯模式的純邏輯:分段、下一個檔名、換掉備註。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentRanges, nextName, replaceNotes } from '../app/player/editor.js';
import { parseSlideFile } from '../app/core/slide.js';

test('segmentRanges:和投影片的切法一致(程式碼區塊裡的 --- 不算)', () => {
  const text = '# A\n\n---\n\n# B\n\n```\n---\n```\n\n---\n\n# C';
  const ranges = segmentRanges(text);
  assert.equal(ranges.length, parseSlideFile(text, { path: 'x.md' }).slides.length);
  assert.equal(ranges.length, 3);
  for (const r of ranges) assert.ok(r.from <= r.to && r.to <= text.length);
  assert.match(text.slice(ranges[0].from, ranges[0].to), /^# A/);
  assert.match(text.slice(ranges[2].from, ranges[2].to), /# C$/);
  // front matter 也不能被當成分隔
  const fm = '---\nlayout: center\n---\n# One';
  assert.equal(segmentRanges(fm).length, 1);
});

test('nextName:接續現有編號', () => {
  assert.equal(nextName(['01-a.md', '02-b.md'], '新的一張'), '03-新的一張.md');
  assert.equal(nextName([], ''), '01-slide.md');
  assert.equal(nextName(['09-x.md'], 'x'), '10-x.md');
  assert.doesNotMatch(nextName([], 'a/b:c*?'), /[\\/:*?"<>|]/, '檔名不能有危險字元');
});

test('replaceNotes:只動指定那一段的備註,內容不受影響', () => {
  const text = '# A\n\n- x\n\nNote:\n舊備註\n\n---\n\n# B\n';
  const out = replaceNotes(text, 0, '新備註');
  assert.match(out, /# A/); assert.match(out, /- x/); assert.match(out, /新備註/);
  assert.doesNotMatch(out, /舊備註/);
  assert.equal(parseSlideFile(out, { path: 'x.md' }).slides.length, 2, '張數不能變');
  assert.equal(parseSlideFile(out, { path: 'x.md' }).slides[0].notes, '新備註');
  assert.equal(parseSlideFile(out, { path: 'x.md' }).slides[1].title, 'B', '另一段不能被動到');
  // 原本沒有備註 → 加上;清空 → 移除
  const added = replaceNotes('# A\n', 0, '來一句');
  assert.equal(parseSlideFile(added, { path: 'x.md' }).slides[0].notes, '來一句');
  const removed = replaceNotes(added, 0, '  ');
  assert.ok(!parseSlideFile(removed, { path: 'x.md' }).slides[0].notes);
  // 第二段
  const second = replaceNotes(text, 1, 'B 的備註');
  assert.equal(parseSlideFile(second, { path: 'x.md' }).slides[0].notes, '舊備註');
  assert.equal(parseSlideFile(second, { path: 'x.md' }).slides[1].notes, 'B 的備註');
});

test('setSegmentMeta:新增、修改、移除這一張的設定', async () => {
  const { setSegmentMeta } = await import('../app/player/editor.js');
  const text = '# A\n\n---\n\n<!-- color: #333 -->\n# B\n\n---\n\n# C\n';
  let r = setSegmentMeta(text, 1, 'layout', 'center');
  assert.equal(r.text, '# A\n\n---\n\n<!-- color: #333 -->\n<!-- layout: center -->\n# B\n\n---\n\n# C\n');
  r = setSegmentMeta(r.text, 1, 'layout', 'quote');
  assert.match(r.text, /<!-- layout: quote -->\n# B/);
  assert.doesNotMatch(r.text, /center/);
  r = setSegmentMeta(r.text, 1, 'layout', '');
  assert.equal(r.text, text, '設成自動就移除那一行');
  r = setSegmentMeta(text, 0, 'layout', 'end');
  assert.ok(r.text.startsWith('<!-- layout: end -->\n# A'));
  // 有 front matter 的檔案:放在 front matter 之後
  r = setSegmentMeta('---\ntitle: x\n---\n# A\n', 0, 'layout', 'center');
  assert.equal(r.text, '---\ntitle: x\n---\n<!-- layout: center -->\n# A\n');
  // 替換範圍和全文一致(編輯框只換這一段)
  const r2 = setSegmentMeta(text, 2, 'layout', 'end');
  assert.equal(text.slice(0, r2.from) + r2.replaced + text.slice(r2.to), r2.text);
});

test('indentLines:多行縮排與反縮排', async () => {
  const { indentLines } = await import('../app/player/editor.js');
  const text = 'a\n- b\n- c\nd';
  const r = indentLines(text, 3, 8);
  assert.equal(text.slice(0, r.from) + r.replaced + text.slice(r.to), 'a\n  - b\n  - c\nd');
  const back = 'a\n  - b\n  - c\nd';
  const r2 = indentLines(back, 4, 12, true);
  assert.equal(back.slice(0, r2.from) + r2.replaced + back.slice(r2.to), text);
  const r3 = indentLines('x\ny', 0, 0, true);
  assert.equal(r3.replaced, 'x', '沒有縮排可去就不變');
});

test('addSegmentMeta:可以重複的設定接在設定區最後', async () => {
  const { addSegmentMeta } = await import('../app/player/editor.js');
  const text = '# A\n\n---\n\n<!-- layout: split -->\n# B\n';
  const r = addSegmentMeta(text, 1, 'mark: 1 2 3 4 ');
  const out = text.slice(0, r.from) + r.replaced + text.slice(r.to);
  assert.equal(out, '# A\n\n---\n\n<!-- layout: split -->\n<!-- mark: 1 2 3 4  -->\n# B\n');
  assert.equal(out.slice(r.caret, r.caret + 4), ' -->', '游標停在標籤位置');
  const r2 = addSegmentMeta('# X\n', 0, 'mark: 5 5 5 5 ');
  assert.equal(r2.replaced, '<!-- mark: 5 5 5 5  -->\n# X\n');
});
