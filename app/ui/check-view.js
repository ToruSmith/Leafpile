// 「檢查」面板:顯示 app/core/check.js 的結果。目錄頁與播放器共用。

import { escapeHTML as esc } from '../core/markdown.js';
import { t } from '../core/i18n.js';

/**
 * @param {HTMLElement} host 面板要放在哪個元素裡
 * @param {(onProgress) => Promise<object>} run 回傳 checkLibrary 格式的報告
 */
export function openCheckPanel(host, run) {
  host.querySelector('.check-panel')?.remove();
  const panel = document.createElement('div');
  panel.className = 'check-panel';
  panel.innerHTML = `<div class="check-card" role="dialog" aria-modal="true" aria-label="${esc(t('checkp.aria'))}">
    <header><h2>${esc(t('checkp.title'))}</h2><button class="check-close" title="${esc(t('checkp.close'))}" aria-label="${esc(t('checkp.close'))}">×</button></header>
    <div class="check-body"><div class="check-progress"><i></i></div><p class="check-status">${esc(t('loading'))}</p></div>
  </div>`;
  host.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add('on'));

  const close = () => { window.removeEventListener('keydown', onKey, true); panel.classList.remove('on'); setTimeout(() => panel.remove(), 250); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } else if (!e.target.closest?.('.check-panel')) e.stopImmediatePropagation(); };
  window.addEventListener('keydown', onKey, true); // 面板開著時,按鍵不傳給播放器
  panel.addEventListener('click', e => { if (e.target === panel || e.target.closest('.check-close')) close(); });

  const body = panel.querySelector('.check-body');
  run((done, total, title) => {
    const bar = body.querySelector('.check-progress i');
    if (bar) bar.style.transform = `scaleX(${total ? done / total : 0})`;
    const st = body.querySelector('.check-status');
    if (st) st.textContent = title ? t('checkp.progress', { i: done + 1, n: total, title }) : t('checkp.finishing');
  }).then(report => { body.innerHTML = renderReport(report); }, err => {
    body.innerHTML = `<p class="check-bad">${esc(t('checkp.failed', { error: err.message || String(err) }))}</p>`;
  });
  return close;
}

function renderReport(r) {
  const decks = r.topics.flatMap(tp => tp.decks);
  const slides = decks.reduce((n, d) => n + d.total, 0);
  const ok = !r.problems.length;
  const summary = `<div class="check-summary ${ok ? 'good' : 'bad'}">
    <b>${esc(ok ? t('check.report.ok') : t('checkp.problems', { n: r.problems.length }))}</b>
    <span>${esc(t('checkp.summary', { decks: decks.length, slides }))}${r.notes ? ' · ' + esc(t('checkp.notesSummary', r.notes)) : ''}</span>
    ${r.warnings?.length ? `<span class="warn-count">${esc(t('checkp.warnings', { n: r.warnings.length }))}</span>` : ''}</div>`;
  const warnings = r.warnings?.length ? `<h3>${esc(t('checkp.warningsHeading'))}</h3><ul class="check-problems warnings">${r.warnings.map(p => `<li><code>${esc(p.path)}</code>${esc(p.message)}</li>`).join('')}</ul>` : '';
  const problems = ok ? '' : `<h3>${esc(t('checkp.problemsHeading'))}</h3><ul class="check-problems">${r.problems.map(p => `<li><code>${esc(p.path)}</code>${esc(p.message)}</li>`).join('')}</ul>`;
  const rows = r.topics.map(tp => `
    ${r.kind === 'library' || r.kind === 'leafpile' ? `<h3>${esc(tp.title)}</h3>` : ''}
    ${tp.decks.length ? tp.decks.map(d => `
      <details class="check-deck">
        <summary>
          <span class="t">${d.problems.length ? '⚠ ' : ''}${esc(d.title)}</span>
          <span class="n">${esc(t('checkp.sections', { n: d.sections.length }))}</span>
          <span class="n">${esc(t('checkp.slides', { n: d.total }))}</span>
          <span class="n">${esc(t('checkp.layouts', { n: d.layouts.length }))}</span>
          <span class="n ${d.noted < d.total ? 'warn' : ''}">${esc(t('checkp.notes', { a: d.noted, b: d.total }))}</span>
        </summary>
        <ol>${d.slides.map(s => `<li><em>${esc(s.layout)}</em>${esc(s.title || t('check.report.untitled'))}${s.notes ? ' <small>📝</small>' : ''}${s.auto ? ` <small>${esc(t('checkp.auto'))}</small>` : ''}</li>`).join('')}</ol>
      </details>`).join('') : `<p class="check-empty">${esc(t('checkp.noDecks'))}</p>`}`).join('');
  return `${summary}${problems}${warnings}<h3 class="check-h">${esc(t('checkp.decksHeading'))}</h3>${rows}
    <p class="check-foot">${esc(t('checkp.foot'))}</p>`;
}
