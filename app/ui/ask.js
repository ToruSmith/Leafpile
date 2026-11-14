// 對卡片問 AI 的對話框:問什麼 → (有私人筆記先確認)→ 複製提示詞 → 開啟選的 AI。
// 提示詞怎麼組在 core/ask.js;這裡不送出任何資料,只用剪貼簿與開新分頁。

import { t } from '../core/i18n.js';
import { AI_TARGETS, aiURL } from '../core/generate.js';
import { buildAskPrompt, privateCount } from '../core/ask.js';
import { dialog, confirmDialog, toast } from './dialog.js';
import { readPref, writePref } from './prefs.js';

const LAST_KEY = 'leafpile-gen-last'; // 和「用 AI 生成」共用上次選的 AI

/** @param {{ cards: object[], neighbors: object[], links: object[], groups: string[] }} ctx  core/ask.js 的 askContext */
export async function askAI(ctx) {
  if (!ctx?.cards?.length) return toast(t('ask.none'), { ms: 4000 });
  let last = {};
  try { last = JSON.parse(readPref(LAST_KEY) || '{}'); } catch { /* 壞掉就當沒選過 */ }
  const lastAI = AI_TARGETS.some(a => a.id === last.target) ? last.target : 'claude';
  const ais = [...AI_TARGETS.filter(a => a.id !== lastAI), AI_TARGETS.find(a => a.id === lastAI)];
  const r = await dialog({
    title: t('ask.title'),
    message: t('ask.lead', { n: ctx.cards.length, m: ctx.neighbors.length }),
    fields: [{ name: 'q', label: t('ask.question'), type: 'textarea', rows: 3, placeholder: t('ask.questionPh') }],
    buttons: [
      { label: t('dialog.cancel'), value: null },
      { label: t('gen.copyOnly'), value: '' },
      ...ais.map((a, i) => ({ label: t('gen.open', { name: a.name }), value: a.id, primary: i === ais.length - 1 })),
    ],
  });
  if (!r || r.value === null) return;
  const priv = privateCount(ctx);
  if (priv && !(await confirmDialog(t('ask.privateAsk', { n: priv }), t('ask.privateOk')))) return;
  const prompt = buildAskPrompt(ctx, r.fields.q || '');
  // 先複製再開分頁:開了新分頁,這一頁就失去焦點,瀏覽器不讓寫剪貼簿
  let copied = false;
  try { await navigator.clipboard.writeText(prompt); copied = true; } catch { /* 沒有權限:下面讓使用者手動複製 */ }
  if (!copied) await dialog({ title: t('ask.manualTitle'), message: t('ask.copyFailed'), fields: [{ name: 'p', label: t('ask.title'), type: 'textarea', rows: 12, value: prompt }], buttons: [{ label: t('dialog.ok'), value: true, primary: true }] });
  if (r.value) {
    writePref(LAST_KEY, JSON.stringify({ ...last, target: r.value }));
    window.open(aiURL(r.value, prompt), '_blank', 'noopener');
  }
  if (copied) toast(t('ask.copied'), { ms: 5000 });
  return prompt;
}
