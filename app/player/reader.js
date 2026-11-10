// 閱讀模式:整份簡報排成一頁往下捲,每張投影片下面接著講者備註。
// 參考 reveal.js 5 的捲動檢視(分段捲軸、捲動時停在最接近的那張),再加上 iA Presenter 式的備註。
// 沒去現場的人讀得懂;按「列印講義」就是附講稿的講義。媒體只在快捲到時才載入。

import { escapeHTML as esc, renderMarkdown } from '../core/markdown.js';
import { t } from '../core/i18n.js';
import { hydrate, stopMedia } from './hydrate.js';
import { zoomableImage, openLightbox } from './lightbox.js';

/** player:提供 deck / slides / sections / source / renderFull()。onIndex(gi):目前讀到第幾張。 */
export function openReader(player, start, { onClose, onIndex, onPrint }) {
  const { slides, sections } = player;
  const el = document.createElement('div');
  el.className = 'reader';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('reader.label'));
  el.innerHTML = `
    <header class="rbar">
      <button class="pbtn" data-r="close" title="${esc(t('reader.closeTitle'))}">${esc(t('reader.close'))}</button>
      <div class="rtitle">${esc(player.deck.title)}</div>
      <button class="pbtn" data-r="print" title="${esc(t('reader.printTitle'))}">${esc(t('reader.print'))}</button>
    </header>
    <main class="rbody">
      ${slides.map((s, gi) => `
        <article class="ritem" data-gi="${gi}">
          <div class="rslide"><div class="rscale">${player.renderFull(gi)}</div></div>
          <div class="rmeta">${gi + 1} / ${slides.length}${sections[s.sec]?.title ? ` · ${esc(sections[s.sec].title)}` : ''}</div>
          ${s.notes ? `<div class="rnotes">${renderMarkdown(s.notes)}</div>` : ''}
        </article>`).join('')}
    </main>
    <nav class="rrail" aria-hidden="true">${slides.map((s, gi) => `<i data-gi="${gi}"${gi && s.sec !== slides[gi - 1].sec ? ' class="sec"' : ''}></i>`).join('')}</nav>`;
  player.el.player.append(el);
  const body = el.querySelector('.rbody');
  const items = [...el.querySelectorAll('.ritem')];
  const rail = [...el.querySelectorAll('.rrail i')];

  // 投影片是 1280×720,依欄寬縮放
  const scale = () => el.style.setProperty('--rs', (items[0]?.querySelector('.rslide').clientWidth || 1280) / 1280);
  const ro = new ResizeObserver(scale);
  ro.observe(body);
  scale();

  // 快捲到時才載入媒體(本機資料可能在隨身碟上)
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting || e.target.dataset.loaded) continue;
      e.target.dataset.loaded = '1';
      hydrate(e.target, player.source, { full: true });
    }
  }, { root: body, rootMargin: '800px 0px' });
  items.forEach(i => io.observe(i));

  let cur = -1;
  const track = () => {
    const mark = body.getBoundingClientRect().top + body.clientHeight * 0.3;
    let gi = 0;
    for (const it of items) { if (it.getBoundingClientRect().top <= mark) gi = +it.dataset.gi; else break; }
    if (gi === cur) return;
    cur = gi;
    rail.forEach((r, i) => r.classList.toggle('on', i === gi));
    onIndex?.(gi);
  };
  let raf = 0;
  body.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(track); }, { passive: true });

  const goto = (gi, smooth = true) => items[gi]?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  el.querySelector('.rrail').addEventListener('click', e => { const i = e.target.closest('[data-gi]'); if (i) goto(+i.dataset.gi); });

  let closeLight = null;
  const close = () => {
    ro.disconnect(); io.disconnect();
    stopMedia(el);
    el.remove();
    onClose?.(Math.max(0, cur));
  };
  el.addEventListener('click', e => {
    const act = e.target.closest('[data-r]')?.dataset.r;
    if (act === 'close') return close();
    if (act === 'print') return onPrint?.();
    const img = zoomableImage(e.target);
    if (img && e.target.closest('.rslide')) closeLight = openLightbox(el, img, { onClose: () => { closeLight = null; } });
  });

  requestAnimationFrame(() => { goto(start, false); track(); });
  body.focus?.();
  return {
    close,
    /** 回傳 true 表示鍵盤事件已處理。 */
    key(k) {
      if (k === 'Escape') { closeLight ? closeLight() : close(); return true; }
      if (closeLight) { closeLight(); return true; }
      if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'PageDown' || k === 'n' || k === 'N') { goto(Math.min(items.length - 1, cur + 1)); return true; }
      if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'PageUp') { goto(Math.max(0, cur - 1)); return true; }
      if (k === 'Home') { goto(0); return true; }
      if (k === 'End') { goto(items.length - 1); return true; }
      if (k === 'm' || k === 'M') { close(); return true; }
      if (k === 'p' || k === 'P') { onPrint?.(); return true; }
      return false; // 其他按鍵交給播放器決定
    },
  };
}
