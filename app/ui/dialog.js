// 小對話框:確認、選擇、輸入。不用瀏覽器的 alert / confirm(會擋住整個頁面,也無法翻譯按鈕)。

import { escapeHTML as esc } from '../core/markdown.js';
import { t } from '../core/i18n.js';

/**
 * @param {{ title?: string, message?: string, fields?: { name, label, value?, type?: 'text'|'select', options?: {value,label}[] }[], buttons: { label, value, primary? }[] }} opts
 * @returns {Promise<{ value: any, fields: Record<string,string> } | null>} 按 Esc 或點外面 = null
 */
export function dialog({ title = '', message = '', fields = [], buttons }) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'lp-dialog';
    box.innerHTML = `<form class="lp-dialog-card" role="dialog" aria-modal="true"${title ? ` aria-label="${esc(title)}"` : ''}>
      ${title ? `<h2>${esc(title)}</h2>` : ''}
      ${message ? `<p>${esc(message)}</p>` : ''}
      ${fields.map(f => `<label><span>${esc(f.label)}</span>${f.type === 'select'
        ? `<select name="${esc(f.name)}">${f.options.map(o => `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
        : `<input name="${esc(f.name)}" value="${esc(f.value || '')}" autocomplete="off"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}>`}</label>`).join('')}
      <div class="lp-dialog-buttons">${buttons.map((b, i) => `<button type="${b.primary ? 'submit' : 'button'}" class="btn ${b.primary ? 'primary' : 'ghost'}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
    </form>`;
    document.body.append(box);
    const form = box.querySelector('form');
    const values = () => Object.fromEntries([...form.querySelectorAll('[name]')].map(el => [el.name, el.value]));
    const done = v => { window.removeEventListener('keydown', onKey, true); box.remove(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(null); } else e.stopImmediatePropagation(); };
    window.addEventListener('keydown', onKey, true);
    box.addEventListener('click', e => {
      if (e.target === box) return done(null);
      const b = e.target.closest('button[data-i]');
      if (b && b.type === 'button') done({ value: buttons[b.dataset.i].value, fields: values() });
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const b = buttons.find(x => x.primary);
      done({ value: b?.value, fields: values() });
    });
    requestAnimationFrame(() => (form.querySelector('input, select') || form.querySelector('.primary'))?.focus());
  });
}

export async function confirmDialog(message, okLabel = t('dialog.ok')) {
  const r = await dialog({ message, buttons: [{ label: t('dialog.cancel'), value: false }, { label: okLabel, value: true, primary: true }] });
  return !!r?.value;
}

/** 右下角的短暫提示。 */
export function toast(message, { ms = 2600 } = {}) {
  const el = document.createElement('div');
  el.className = 'lp-toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 300); }, ms);
}
