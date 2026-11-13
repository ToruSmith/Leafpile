// 「用 AI 生成」精靈:填資料 → 複製提示詞並開啟 AI → 貼回回覆。
// 只負責問使用者;提示詞與組檔案在 core/generate.js,匯入(預覽、寫入、復原)在 main.js 的 importFiles。

import { t } from '../core/i18n.js';
import { dialog } from './dialog.js';
import { AI_TARGETS, GEN_KINDS } from '../core/generate.js';
import { readPref, writePref } from './prefs.js';

const LAST_KEY = 'leafpile-gen-last'; // 上次選的類別、主題與 AI(只存在這個瀏覽器)

/**
 * 第一步。回傳 { kind, topicId, title, extra, data, target('' = 只複製) } 或 null。
 * @param {{ topics: { id: string, title: string }[] }} opts
 */
export async function generateDialog({ topics }) {
  let last = {};
  try { last = JSON.parse(readPref(LAST_KEY) || '{}'); } catch { /* 壞掉就當沒選過 */ }
  const topicOptions = topics.length ? topics.map(tp => ({ value: tp.id, label: tp.title })) : [{ value: '', label: t('gen.newTopic') }];
  let fields = {
    kind: GEN_KINDS.includes(last.kind) ? last.kind : 'note',
    topic: topics.some(tp => tp.id === last.topic) ? last.topic : topicOptions[0].value,
    title: '', extra: '', data: '',
  };
  let error = '';
  const lastAI = AI_TARGETS.some(a => a.id === last.target) ? last.target : 'claude';
  // 上次用的 AI 放在最右邊(主要按鈕)
  const ais = [...AI_TARGETS.filter(a => a.id !== lastAI), AI_TARGETS.find(a => a.id === lastAI)];
  for (;;) {
    const r = await dialog({
      title: t('gen.title'),
      message: t('gen.lead'),
      error,
      fields: [
        { name: 'kind', label: t('gen.kind'), type: 'select', value: fields.kind, options: GEN_KINDS.map(k => ({ value: k, label: t('gen.kind.' + k) })) },
        { name: 'topic', label: t('gen.topic'), type: 'select', value: fields.topic, options: topicOptions },
        { name: 'title', label: t('gen.titleLabel'), value: fields.title, placeholder: t('gen.titlePh') },
        { name: 'extra', label: t('gen.extra'), value: fields.extra, placeholder: t('gen.extraPh') },
        { name: 'data', label: t('gen.data'), type: 'textarea', rows: 8, value: fields.data, placeholder: t('gen.dataPh') },
      ],
      note: t('gen.note'),
      buttons: [
        { label: t('dialog.cancel'), value: null },
        { label: t('gen.copyOnly'), value: '' },
        ...ais.map((a, i) => ({ label: t('gen.open', { name: a.name }), value: a.id, primary: i === ais.length - 1 })),
      ],
    });
    if (!r || r.value === null) return null;
    fields = r.fields;
    if (!String(fields.title || '').trim()) { error = t('gen.needTitle'); continue; }
    writePref(LAST_KEY, JSON.stringify({ kind: fields.kind, topic: fields.topic, target: r.value || last.target || '' }));
    return { kind: fields.kind, topicId: fields.topic, title: fields.title.trim(), extra: fields.extra || '', data: fields.data, target: r.value };
  }
}

/**
 * 第二步:收回 AI 的成果。可以貼上文字、選 AI 給的 zip,或複製規格全文(AI 打不開網址時)。
 * 回傳 { text } | { zip: true } | { spec: true, reply } | null。
 */
export async function replyDialog({ prompt, opened, reply = '' }) {
  const r = await dialog({
    title: t('gen.pasteTitle'),
    message: t('gen.pasteLead', { where: opened ? t('gen.whereOpened', { name: opened }) : t('gen.whereNone') }),
    fields: [
      { name: 'prompt', label: t('gen.promptLabel'), type: 'textarea', rows: 3, value: prompt },
      { name: 'reply', label: t('gen.replyLabel'), type: 'textarea', rows: 8, value: reply, placeholder: t('gen.replyPh') },
    ],
    buttons: [
      { label: t('dialog.cancel'), value: null },
      { label: t('gen.copySpec'), value: 'spec' },
      { label: t('gen.pickZip'), value: 'zip' },
      { label: t('pack.next'), value: 'text', primary: true },
    ],
  });
  if (!r || r.value == null) return null;
  if (r.value === 'zip') return { zip: true };
  if (r.value === 'spec') return { spec: true, reply: r.fields.reply };
  return { text: r.fields.reply };
}
