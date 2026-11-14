// 斜線選單的畫面:接在一個 <textarea> 上。輸入 / 跳出選單,↑↓ 選、Enter 或 Tab 插入、Esc 關掉。
// 規則與要插入的內容在 core/slash.js;這裡只管顯示、鍵盤與游標位置。
// 筆記編輯器與畫布的側邊面板共用。

import { escapeHTML as esc } from '../core/markdown.js';
import { t } from '../core/i18n.js';
import { slashQuery, filterSlash, applySlash } from '../core/slash.js';

/** 量出 textarea 裡游標的位置(畫面座標):用一個樣式相同的隱形 div 排出游標前的文字。 */
function caretRect(ta) {
  const cs = getComputedStyle(ta);
  const div = document.createElement('div');
  for (const p of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'tabSize', 'textIndent', 'wordSpacing']) div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', top: '0', left: '-9999px' });
  div.textContent = ta.value.slice(0, ta.selectionStart);
  const mark = document.createElement('span');
  mark.textContent = '​';
  div.append(mark);
  document.body.append(div);
  const r = ta.getBoundingClientRect();
  const x = r.left + mark.offsetLeft - ta.scrollLeft, y = r.top + mark.offsetTop - ta.scrollTop;
  const h = mark.offsetHeight || parseFloat(cs.lineHeight) || 20;
  div.remove();
  return { x, y, h };
}

/**
 * @param {HTMLTextAreaElement} ta
 * @returns {{ dispose: () => void, isOpen: () => boolean }}
 */
export function attachSlash(ta) {
  const menu = document.createElement('div');
  menu.className = 'slash-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', t('slash.aria'));
  menu.hidden = true;
  document.body.append(menu);
  let items = [], idx = 0, q = null, dismissed = -1;

  const hide = () => { menu.hidden = true; q = null; };
  const label = id => t('slash.' + id);

  function update() {
    if (ta.readOnly || ta.selectionStart !== ta.selectionEnd) return hide();
    const found = slashQuery(ta.value, ta.selectionStart);
    if (!found || found.start === dismissed) { if (!found) dismissed = -1; return hide(); }
    items = filterSlash(found.query, label);
    if (!items.length) return hide();
    if (!q || q.start !== found.start || q.query !== found.query) idx = 0;
    q = found;
    menu.innerHTML = `<div class="sm-head">${esc(t('slash.head'))}</div>` + items.map((it, i) => `<button type="button" role="option" data-i="${i}" class="${i === idx ? 'on' : ''}" aria-selected="${i === idx}"><span class="sm-icon">${esc(it.icon)}</span><span>${esc(label(it.id))}</span></button>`).join('');
    menu.hidden = false;
    place();
  }

  function place() {
    const c = caretRect(ta), w = menu.offsetWidth, h = menu.offsetHeight;
    const vw = innerWidth, vh = innerHeight;
    let x = Math.min(c.x, vw - w - 8), y = c.y + c.h + 4;
    if (y + h > vh - 8) y = Math.max(8, c.y - h - 4); // 下面放不下就放上面
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${y}px`;
  }

  function choose(i) {
    const it = items[i];
    if (!it || !q) return;
    const old = ta.value;
    const r = applySlash(old, q, it, { cols: [t('slash.col', { n: 1 }), t('slash.col', { n: 2 })] });
    // 只換掉不一樣的那一段,瀏覽器的復原(Ctrl+Z)才能一步退回
    let a = 0;
    while (a < old.length && a < r.text.length && old[a] === r.text[a]) a++;
    let b = 0;
    while (b < old.length - a && b < r.text.length - a && old[old.length - 1 - b] === r.text[r.text.length - 1 - b]) b++;
    const piece = r.text.slice(a, r.text.length - b);
    hide();
    ta.focus();
    ta.setSelectionRange(a, old.length - b);
    const ok = piece ? document.execCommand?.('insertText', false, piece) : document.execCommand?.('delete');
    if (!ok || ta.value !== r.text) { ta.value = r.text; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    ta.setSelectionRange(r.selStart, r.selEnd);
  }

  const move = d => {
    idx = (idx + d + items.length) % items.length;
    menu.querySelectorAll('[data-i]').forEach((b, i) => { b.classList.toggle('on', i === idx); b.setAttribute('aria-selected', String(i === idx)); });
    menu.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  // 捕獲階段:選單開著時,方向鍵、Enter、Tab、Esc 先給選單(不讓編輯器的其他處理接手)
  const onKeydown = e => {
    if (menu.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); move(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); choose(idx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); dismissed = q?.start ?? -1; hide(); }
  };
  const onInput = () => update();
  const onCaret = e => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) update(); };
  const onBlur = () => setTimeout(hide, 120);
  const onScroll = () => { if (!menu.hidden) place(); };
  ta.addEventListener('keydown', onKeydown, true);
  ta.addEventListener('input', onInput);
  ta.addEventListener('keyup', onCaret);
  ta.addEventListener('click', onInput);
  ta.addEventListener('blur', onBlur);
  ta.addEventListener('scroll', onScroll);
  menu.addEventListener('mousedown', e => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); choose(Number(b.dataset.i)); } });

  return {
    isOpen: () => !menu.hidden,
    dispose: () => {
      menu.remove();
      ta.removeEventListener('keydown', onKeydown, true);
      ta.removeEventListener('input', onInput); ta.removeEventListener('keyup', onCaret);
      ta.removeEventListener('click', onInput); ta.removeEventListener('blur', onBlur); ta.removeEventListener('scroll', onScroll);
    },
  };
}
