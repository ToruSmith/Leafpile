// 筆記閱讀頁:置中單欄 + 右側欄(目錄、反向連結、被哪些簡報引用)。
// [[連結]] 一律先指向 #/…/go/…,點了才用圖譜解析(圖譜可能還在背景建立)。

import { escapeHTML as esc, renderMarkdown } from '../../core/markdown.js';
import { linkLabel } from '../../core/note.js';
import { resolveMediaPath } from '../../core/media.js';
import { hydrate } from '../../player/hydrate.js';
import { openLightbox } from '../../player/lightbox.js';
import { applyUITheme } from '../../player/themes.js';
import { t } from '../../core/i18n.js';
import { notesOfTopic } from '../../core/vault.js';
import { sourceStatus } from '../../core/graph.js';
import { resolvePublic, isLocalOnly } from '../../core/privacy.js';

const SCALE_KEY = 'leafpile-note-scale';
const SCALES = [0.9, 1, 1.12, 1.25, 1.4];

function savedScale() {
  try { const v = Number(localStorage.getItem(SCALE_KEY)); return SCALES.includes(v) ? v : 1; } catch { return 1; }
}

/** 筆記裡的圖片路徑:/ 開頭 = 筆記渠道根目錄;其他 = 相對於這篇筆記所在的資料夾。 */
export function noteMediaPath(src, notePath) {
  const dir = notePath.split('/').slice(0, -1).join('/');
  return resolveMediaPath(src.startsWith('/') ? src : src.startsWith('.') ? src : './' + src, { projectPath: '', filePath: dir ? dir + '/x' : 'x' });
}

/**
 * @param {HTMLElement} root
 * @param {{ vault, rel: string, note: object, topic: object, book: object|null, header: string, href: object, graph: Promise, heading?: string, canEdit: boolean }} opts
 *   note = core/note.js 的 parseNote 結果;href = { shelf, note(rel, heading?), go(raw, fromRel), deck(topicId, projectId), flash(rel), edit(rel), deckByPath(path) }
 */
export function renderReader(root, { vault, rel, note, topic, book, header, href, graph, heading, canEdit, canPromote, boards = null }) {
  applyUITheme(vault.theme || 'paper');
  const siblings = book ? book.notes : notesOfTopic(topic).filter(n => !n.bookPath);
  const idx = siblings.findIndex(n => n.path === rel);
  const prev = siblings[idx - 1], next = siblings[idx + 1];
  const isPublic = resolvePublic({ note, book: book?.conf, topic: topic.conf });
  const localOnly = isLocalOnly(topic.conf);
  const hasH1 = note.headings.some(h => h.level === 1);
  const html = renderMarkdown(note.body, {
    headingIds: true,
    image: (src, alt) => `<img data-media="${esc(noteMediaPath(src, rel))}" alt="${esc(alt)}" loading="lazy">`,
    wikilink: l => `<a class="wikilink${l.embed ? ' embed' : ''}${l.channel === 'slides' ? ' to-deck' : ''}" href="${href.go(l, rel)}" data-raw="${esc(JSON.stringify({ channel: l.channel, target: l.target, heading: l.heading }))}"${l.label ? '' : ' data-auto="1"'}>${esc(linkLabel(l))}</a>`,
  });
  const toc = note.headings.filter(h => h.level >= 2 && h.level <= 3);
  const scale = savedScale();

  root.innerHTML = `
    <div class="note-page" style="--note-scale:${scale}">
      ${header}
      <nav class="crumbs" aria-label="${esc(t('note.crumbs'))}">
        <a href="${href.shelf}">${esc(vault.title)}</a><span>›</span>
        <span>${esc(topic.title)}</span>
        ${book ? `<span>›</span><span>${esc(book.title)}</span>` : ''}
      </nav>
      <div class="note-layout">
        ${siblings.length > 1 ? `<aside class="note-left" aria-label="${esc(t(book ? 'note.chapters' : 'note.inTopic'))}">
          <h3>${esc(book ? book.title : topic.title)}</h3>
          ${book?.author ? `<p class="by">${esc(book.author)}</p>` : ''}
          <ol>${siblings.map(n => `<li class="${n.path === rel ? 'on' : ''}"><a href="${href.note(n.path)}">${esc(n.path === rel ? note.title : n.title)}</a></li>`).join('')}</ol>
        </aside>` : '<div></div>'}
        <article class="note-article"${note.lang ? ` lang="${esc(note.lang)}"` : ''}>
          <div class="note-meta">
            ${note.date ? `<span>${esc(note.date)}</span>` : ''}
            <span class="vis ${localOnly ? 'local' : isPublic ? 'public' : 'private'}" title="${esc(t(localOnly ? 'note.localOnlyTitle' : isPublic ? 'note.publicTitle' : 'note.privateTitle'))}">${esc(t(localOnly ? 'note.localOnly' : isPublic ? 'note.public' : 'note.private'))}</span>
            ${note.pinned ? `<span class="pin">${esc(note.expires ? t('note.pinnedUntil', { date: note.expires }) : t('note.pinned'))}</span>` : ''}
            ${note.tags.map(x => `<span class="tag">#${esc(x)}</span>`).join('')}
          </div>
          ${hasH1 ? '' : `<h1>${esc(note.title)}</h1>`}
          <div class="md">${html}</div>
          ${note.source ? `<p class="note-source">${esc(t('note.sourceLabel'))}<a href="${esc(/^https?:/i.test(note.source) ? note.source : '#')}" target="_blank" rel="noopener">${esc(note.source)}</a></p>` : ''}
          <nav class="note-pager">
            ${prev ? `<a class="prev" href="${href.note(prev.path)}"><small>${esc(t('note.prev'))}</small>${esc(prev.title)}</a>` : '<span></span>'}
            ${next ? `<a class="next" href="${href.note(next.path)}"><small>${esc(t('note.next'))}</small>${esc(next.title)}</a>` : '<span></span>'}
          </nav>
        </article>
        <aside class="note-side">
          <div class="note-tools">
            <a class="btn primary flash" href="${href.flash(rel)}" title="${esc(t('note.flashTitle'))}">▶ ${esc(t('note.flash'))}</a>
            ${canEdit ? `<a class="btn ghost" href="${href.edit(rel)}" title="${esc(t('note.editTitle'))}">${esc(t('note.edit'))}</a>` : ''}
            ${canPromote ? `<button class="btn ghost promote" title="${esc(t('promote.buttonTitle'))}">${esc(t('promote.button'))}</button>` : ''}
            ${canPromote ? `<details class="note-more"><summary class="btn ghost" title="${esc(t('move.moreTitle'))}">${esc(t('move.more'))}</summary><div class="note-more-menu">
              <button data-act="rename">${esc(t('move.rename'))}</button><button data-act="move">${esc(t('move.move'))}</button><button data-act="archive">${esc(t('move.archive'))}</button></div></details>` : ''}
            <span class="scale"><button data-scale="-1" title="${esc(t('note.smaller'))}" aria-label="${esc(t('note.smaller'))}">A−</button><button data-scale="1" title="${esc(t('note.larger'))}" aria-label="${esc(t('note.larger'))}">A+</button></span>
          </div>
          ${toc.length ? `<section class="toc"><h3>${esc(t('note.toc'))}</h3><ol>${toc.map(h => `<li class="l${h.level}"><a href="#" data-slug="${esc(h.slug)}">${esc(h.text)}</a></li>`).join('')}</ol></section>` : ''}
          <section class="backlinks"><h3>${esc(t('note.backlinks'))}</h3><p class="muted">${esc(t('note.indexing'))}</p></section>
          <section class="used-by" hidden><h3>${esc(t('note.usedByDecks'))}</h3><ul></ul></section>
          <section class="on-boards" hidden><h3>${esc(t('note.onBoards'))}</h3><ul></ul></section>
        </aside>
      </div>
    </div>`;

  const article = root.querySelector('.note-article');
  hydrate(article, vault.notesSource);
  let closeBox = null;
  article.querySelectorAll('.md img').forEach(img => {
    img.style.cursor = 'zoom-in';
    img.addEventListener('click', () => { if (img.currentSrc || img.src) closeBox = openLightbox(document.body, img, { onClose: () => { closeBox = null; } }); });
  });

  const scrollTo = slug => root.querySelector(`#h-${CSS.escape(slug)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  root.querySelectorAll('.toc a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); scrollTo(a.dataset.slug); history.replaceState(null, '', href.note(rel, a.dataset.slug)); }));
  if (heading) requestAnimationFrame(() => scrollTo(heading));
  else window.scrollTo(0, 0);

  boards?.then(names => {
    const sec = root.querySelector('.on-boards');
    if (!sec || !names.length) return;
    sec.querySelector('ul').innerHTML = names.map(n => `<li><a href="${href.board(n)}">▢ ${esc(n)}</a></li>`).join('');
    sec.hidden = false;
  }, () => {});
  root.querySelector('.promote')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('leafpile:promote', { detail: rel })));
  root.querySelectorAll('.note-more [data-act]').forEach(b => b.addEventListener('click', () => {
    b.closest('details').open = false;
    window.dispatchEvent(new CustomEvent('leafpile:note-action', { detail: { action: b.dataset.act, rel } }));
  }));
  const page = root.querySelector('.note-page');
  root.querySelectorAll('[data-scale]').forEach(b => b.addEventListener('click', () => {
    const cur = SCALES.indexOf(Number(page.style.getPropertyValue('--note-scale')) || 1);
    const v = SCALES[Math.min(SCALES.length - 1, Math.max(0, (cur < 0 ? 1 : cur) + Number(b.dataset.scale)))];
    page.style.setProperty('--note-scale', v);
    try { localStorage.setItem(SCALE_KEY, String(v)); } catch { /* 隱私模式 */ }
  }));

  // 目錄:捲動時標出目前所在的段落
  const heads = [...article.querySelectorAll('h2[id], h3[id]')];
  const tocLinks = new Map([...root.querySelectorAll('.toc a')].map(a => ['h-' + a.dataset.slug, a]));
  const io = heads.length ? new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) {
      tocLinks.forEach(a => a.classList.remove('on'));
      tocLinks.get(en.target.id)?.classList.add('on');
    }
  }, { rootMargin: '0px 0px -70% 0px' }) : null;
  heads.forEach(h => io.observe(h));

  // 快捷鍵:← → 上一篇 / 下一篇、P 快閃播放、E 編輯
  const onKey = e => {
    if (closeBox) { if (e.key === 'Escape') closeBox(); return; }
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft' && prev) location.hash = href.note(prev.path);
    else if (e.key === 'ArrowRight' && next) location.hash = href.note(next.path);
    else if (e.key.toLowerCase() === 'p') location.hash = href.flash(rel);
    else if (e.key.toLowerCase() === 'e' && canEdit) location.hash = href.edit(rel);
  };
  window.addEventListener('keydown', onKey);

  // 圖譜建好:反向連結、被簡報引用、標出找不到的連結
  let alive = true;
  graph?.then(g => {
    if (!alive) return;
    const me = vault.notePath(rel);
    const back = g.backlinks.get(me) || [];
    const fromNotes = back.filter(b => b.from.kind === 'note');
    const fromDecks = back.filter(b => b.from.kind === 'deck');
    const bl = root.querySelector('.backlinks');
    bl.innerHTML = `<h3>${esc(t('note.backlinks'))}<small>${fromNotes.length}</small></h3>` + (fromNotes.length
      ? `<ul>${fromNotes.map(b => `<li><a href="${href.note(b.from.rel)}">${esc(b.from.title)}</a>${b.from.excerpt ? `<span>${esc(b.from.excerpt)}</span>` : ''}</li>`).join('')}</ul>`
      : `<p class="muted">${esc(t('note.noBacklinks'))}</p>`);
    const ub = root.querySelector('.used-by');
    ub.hidden = !fromDecks.length;
    ub.querySelector('ul').innerHTML = fromDecks.map(b => {
      // 反向連結裡一份簡報只算一次:既是升級來源又有連結時 via 是 link,所以直接看 source
      const st = b.from.source ? sourceStatus(g, b.from) : null;
      const isSource = !!st?.notes.some(n => n.rel === rel);
      const stale = isSource && st.status === 'changed' ? `<small class="stale" title="${esc(t('note.sourceChangedTip'))}">${esc(t('note.sourceChanged'))}</small>` : '';
      return `<li><a href="${href.deck(b.from.topicId, b.from.project.id)}">▦ ${esc(b.from.title)}</a><small>${esc(t(isSource || b.via === 'source' ? 'note.viaSource' : 'note.viaLink'))}</small>${stale}</li>`;
    }).join('');
    for (const a of article.querySelectorAll('a.wikilink[data-raw]')) {
      let l;
      try { l = JSON.parse(a.dataset.raw); } catch { continue; }
      const res = g.resolver.resolve(l, { fromTopic: topic.id, fromPath: me });
      if (res.status === 'missing') { a.classList.add('missing'); a.title = t('note.linkMissing'); }
      else if (res.status === 'ambiguous') a.title = t('note.linkAmbiguous', { n: res.candidates.length });
      else if (res.target) a.title = res.target.title;
      // 沒有自訂顯示文字時,用目標的標題(比檔名好讀)
      if (res.target && a.dataset.auto) a.textContent = res.target.title + (l.heading ? ' › ' + l.heading : '');
    }
  }, () => {
    const bl = root.querySelector('.backlinks p');
    if (bl) bl.textContent = t('note.indexFailed');
  });

  return () => { alive = false; closeBox?.(); io?.disconnect(); window.removeEventListener('keydown', onKey); };
}
