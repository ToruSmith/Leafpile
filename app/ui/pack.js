// 書庫包的對話框:選匯出或匯入、選匯入的來源、匯入前的預覽。
// 只負責問使用者;讀檔、寫檔與復原在 main.js(exportPack、importPack)。

import { t } from '../core/i18n.js';
import { dialog } from './dialog.js';

/** 書庫頁的「書庫包」:回傳 'all' | 'public' | 'import' | null。 */
export async function packDialog({ canImport }) {
  const r = await dialog({
    title: t('pack.title'),
    message: t('pack.lead'),
    note: canImport ? t('pack.importNote') : t('pack.readonlyNote'),
    buttons: [
      { label: t('dialog.cancel'), value: null },
      ...(canImport ? [{ label: t('pack.import'), value: 'import' }] : []),
      { label: t('pack.exportPublic'), value: 'public' },
      { label: t('pack.exportAll'), value: 'all', primary: true },
    ],
  });
  return r?.value || null;
}

/** 匯入的來源:'zip' | 'folder' | 'text' | null。 */
export async function importSourceDialog() {
  const r = await dialog({
    title: t('pack.importTitle'),
    message: t('pack.importLead'),
    buttons: [
      { label: t('dialog.cancel'), value: null },
      { label: t('pack.fromText'), value: 'text' },
      { label: t('pack.fromFolder'), value: 'folder' },
      { label: t('pack.fromZip'), value: 'zip', primary: true },
    ],
  });
  return r?.value || null;
}

/** 貼上 AI 給的文字書庫包。回傳文字或 null。 */
export async function pasteDialog() {
  const r = await dialog({
    title: t('pack.pasteTitle'),
    message: t('pack.pasteLead'),
    fields: [{ name: 'text', label: t('pack.pasteLabel'), type: 'textarea', rows: 12, placeholder: '=== FILE: notes/01-inbox/2026-11-13-example.md ===\n# …\n=== END ===' }],
    buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('pack.next'), value: true, primary: true }],
  });
  return r?.value ? r.fields.text : null;
}

/** 預覽的清單:每一類各列幾行,太多就摘要。 */
export function describePlan(plan, max = 40) {
  const lines = [];
  const of = a => plan.items.filter(i => i.action === a);
  for (const i of of('merge')) lines.push(t('pack.line.merge', { path: i.path, list: i.added.join(t('pack.sep')) }));
  for (const i of of('rename')) lines.push(t('pack.line.rename', { from: i.from, to: i.path }));
  for (const i of of('keep')) lines.push(t('pack.line.keep', { path: i.path }));
  const adds = of('add');
  const renamedDecks = adds.filter(i => i.note === 'deckRenamed');
  const decks = [...new Set(renamedDecks.map(i => i.path.split('/').slice(0, 3).join('/')))];
  for (const d of decks) lines.push(t('pack.line.deck', { path: d }));
  for (const i of adds.filter(x => x.note !== 'deckRenamed')) lines.push(t('pack.line.add', { path: i.path }));
  const skips = of('skip').filter(i => i.reason !== 'tool');
  for (const i of skips) lines.push(t('pack.line.skip', { path: i.from, reason: t('pack.reason.' + i.reason) }));
  return lines.length > max ? [...lines.slice(0, max), t('pack.line.more', { n: lines.length - max })] : lines;
}

/** 「新增 2 個、另存 1 個…」:只列有數量的項目。 */
const countsText = c => ['add', 'rename', 'merge', 'same', 'keep', 'skip'].filter(k => c[k]).map(k => t('pack.count.' + k, { n: c[k] })).join(t('pack.sep'));

/** 匯入預覽:確認就回傳 true。 */
export async function previewDialog(plan, { label }) {
  const c = plan.counts;
  const writes = (c.add || 0) + (c.rename || 0) + (c.merge || 0);
  if (!writes) {
    await dialog({ title: t('pack.previewTitle'), message: t('pack.nothing', { list: countsText(c) || '0' }), list: describePlan(plan), buttons: [{ label: t('dialog.ok'), value: true, primary: true }] });
    return false;
  }
  const lost = plan.items.find(i => i.action === 'merge' && i.lostComments);
  const r = await dialog({
    title: t('pack.previewTitle'),
    message: t('pack.summary', { from: label, list: countsText(c) }),
    list: describePlan(plan),
    note: [t('pack.safeNote'), lost ? t('pack.lostComments', { n: lost.lostComments }) : ''].filter(Boolean).join(' '),
    buttons: [{ label: t('dialog.cancel'), value: false }, { label: t('pack.doImport', { n: writes }), value: true, primary: true }],
  });
  return !!r?.value;
}
