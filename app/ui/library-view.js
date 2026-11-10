// 簡報卡片:書架上的一份簡報。封面只在卡片捲進畫面時才讀(IntersectionObserver)。
// 由 ui/shelf.js 使用;卡片的樣式與 3D 傾斜沿用 Mdslide Pile。

import { loadCover, limiter } from '../core/library.js';
import { escapeHTML as esc } from '../core/markdown.js';
import { renderSlide } from '../player/render.js';
import { hydrate } from '../player/hydrate.js';
import { t } from '../core/i18n.js';

const coverLimit = limiter(3);

/** 一張簡報卡片的 HTML。search = 篩選用的文字(小寫)。 */
export function deckCardHTML(tp, p, href) {
  const search = [p.title, p.subtitle, p.author, p.event, p.date, p.id, ...p.tags, tp.title].filter(Boolean).join(' ').toLowerCase();
  return `<a class="deck-card" href="${href}" data-topic="${esc(tp.id)}" data-project="${esc(p.id)}" data-search="${esc(search)}">
    <div class="thumb"><div class="thumb-inner"></div><div class="shine"></div></div>
    <div class="info">
      <h3>${esc(p.title)}</h3>
      ${p.subtitle ? `<p class="sub">${esc(p.subtitle)}</p>` : ''}
      ${p.tags.length ? `<div class="tags">${p.tags.map(x => `<span>#${esc(x)}</span>`).join('')}</div>` : ''}
      <div class="meta">${p.author ? `<span class="author">${esc(p.author)}</span>` : ''}<span class="date">${esc(p.date || '')}</span><span class="count"></span></div>
    </div>
  </a>`;
}

/**
 * 讓卡片動起來:預設封面、捲進畫面才讀第一張、3D 傾斜。回傳清理函式。
 * @param {HTMLElement[]} cards
 * @param {{ find: (el) => object, source: object, theme: string }} opts
 */
export function wireDeckCards(cards, { find, source, theme }) {
  for (const el of cards) {
    const p = find(el);
    const inner = el.querySelector('.thumb-inner');
    inner.dataset.theme = p.theme || theme || 'paper'; // 封面用簡報播放時的主題,不跟著書架的主題
    inner.innerHTML = coverHTML(p, null);
  }
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const el = en.target, p = find(el);
      coverLimit(() => loadCover(source, p)).then(info => {
        el.querySelector('.count').textContent = info.sections ? t('lib.chapters', { n: info.sections }) : '';
        const inner = el.querySelector('.thumb-inner');
        if (info.firstSlide) inner.innerHTML = coverHTML(p, info.firstSlide);
        hydrate(inner, source);
      }, () => {});
    }
  }, { rootMargin: '200px' });
  cards.forEach(c => io.observe(c));

  for (const el of cards) {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--rx', `${-y * 10}deg`);
      el.style.setProperty('--ry', `${x * 12}deg`);
      el.style.setProperty('--mx', `${(x + 0.5) * 100}%`);
      el.style.setProperty('--my', `${(y + 0.5) * 100}%`);
    });
    el.addEventListener('pointerleave', () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
  }
  return () => io.disconnect();
}

function coverHTML(project, firstSlide) {
  const deck = { ...project, sections: [{ title: '', color: project.accent || '', slides: [] }] };
  const slide = firstSlide
    ? { ...firstSlide, sec: 0, i: 0 }
    : { layout: 'title', meta: {}, body: '', media: [], file: project.path, sec: 0, i: 0 };
  if (!deck.sections[0].color) delete deck.sections[0].color;
  return renderSlide(slide, { deck, mode: 'thumb', globalIndex: 0, total: 1 });
}
