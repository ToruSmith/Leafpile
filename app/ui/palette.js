// Ctrl+K / ⌘K 指令面板:搜尋筆記、簡報,或執行動作(新增筆記、快閃播放、檢查、切換語言…)。

import { escapeHTML as esc } from '../core/markdown.js';
import { norm } from '../core/links.js';
import { t } from '../core/i18n.js';

let open = null;

/**
 * @param {{ items: () => { kind: 'note'|'deck'|'action', title: string, hint?: string, search?: string, run: Function }[], placeholder?: string }} opts
 */
export function openPalette({ items, placeholder = t('palette.placeholder') }) {
  if (open) { open.input.focus(); return open.close; }
  const all = items();
  const box = document.createElement('div');
  box.className = 'palette';
  box.innerHTML = `<div class="palette-card" role="dialog" aria-modal="true" aria-label="${esc(t('palette.label'))}">
    <input type="search" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" role="combobox" aria-expanded="true" aria-controls="palette-list" autocomplete="off">
    <ul id="palette-list" role="listbox"></ul>
    <footer><span><kbd>↑</kbd><kbd>↓</kbd> ${esc(t('palette.move'))}</span><span><kbd>Enter</kbd> ${esc(t('palette.go'))}</span><span><kbd>Esc</kbd> ${esc(t('palette.close'))}</span></footer>
  </div>`;
  document.body.append(box);
  const input = box.querySelector('input'), list = box.querySelector('ul');
  let shown = [], cur = 0;
  const icon = k => ({ note: '¶', deck: '▦', action: '›' }[k] || '·');

  const render = () => {
    const words = norm(input.value).split(' ').filter(Boolean);
    const score = it => {
      const title = norm(it.title);
      return words.filter(w => title.includes(w)).length * 10 + (words[0] && title.startsWith(words[0]) ? 5 : 0) + (it.kind === 'action' ? 1 : 0);
    };
    shown = words.length
      ? all.filter(it => words.every(w => (it.search || norm(it.title + ' ' + (it.hint || ''))).includes(w))).sort((a, b) => score(b) - score(a)).slice(0, 40)
      : [...all.filter(it => it.kind === 'action'), ...all.filter(it => it.kind !== 'action').slice(0, 12)];
    cur = Math.min(cur, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length ? shown.map((it, i) => `<li role="option" data-i="${i}" aria-selected="${i === cur}" class="k-${it.kind}"><span class="ic">${icon(it.kind)}</span><b>${esc(it.title)}</b>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</li>`).join('')
      : `<li class="none">${esc(t('palette.none'))}</li>`;
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const move = d => { if (!shown.length) return; cur = (cur + d + shown.length) % shown.length; render(); };
  const close = () => { window.removeEventListener('keydown', onKey, true); box.remove(); open = null; };
  const go = i => { const it = shown[i]; if (!it) return; close(); it.run(); };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(cur); }
    e.stopImmediatePropagation(); // 面板開著時,按鍵不傳給播放器或書架
  };
  window.addEventListener('keydown', onKey, true);
  input.addEventListener('input', () => { cur = 0; render(); });
  list.addEventListener('mousemove', e => { const li = e.target.closest('[data-i]'); if (li && Number(li.dataset.i) !== cur) { cur = Number(li.dataset.i); list.querySelectorAll('[data-i]').forEach(x => x.setAttribute('aria-selected', String(Number(x.dataset.i) === cur))); } });
  list.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) go(Number(li.dataset.i)); });
  box.addEventListener('click', e => { if (e.target === box) close(); });
  render();
  input.focus();
  open = { close, input };
  return close;
}
