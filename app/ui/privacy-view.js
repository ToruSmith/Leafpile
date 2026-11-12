// 「發布前檢查」面板:哪些筆記會公開、哪裡可能有個資(app/core/privacy.js 的 auditPrivacy)。
// 外框沿用「檢查」面板的樣式。螢幕上的個資一律遮罩顯示。

import { escapeHTML as esc } from '../core/markdown.js';
import { t } from '../core/i18n.js';
import { maskPII } from '../core/privacy.js';

/**
 * @param {HTMLElement} host
 * @param {() => Promise<ReturnType<import('../core/privacy.js').auditPrivacy>>} run
 * @param {{ href: object, visitor: boolean, onVisitor: (on: boolean) => void }} opts
 */
export function openPrivacyPanel(host, run, { href, visitor, onVisitor }) {
  host.querySelector('.check-panel')?.remove();
  const panel = document.createElement('div');
  panel.className = 'check-panel privacy-panel';
  panel.innerHTML = `<div class="check-card" role="dialog" aria-modal="true" aria-label="${esc(t('privacy.title'))}">
    <header><h2>${esc(t('privacy.title'))}</h2><button class="check-close" title="${esc(t('checkp.close'))}" aria-label="${esc(t('checkp.close'))}">×</button></header>
    <div class="check-body"><p class="check-status">${esc(t('privacy.scanning'))}</p></div>
  </div>`;
  host.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add('on'));

  const close = () => { window.removeEventListener('keydown', onKey, true); panel.classList.remove('on'); setTimeout(() => panel.remove(), 250); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } else if (!e.target.closest?.('.check-panel')) e.stopImmediatePropagation(); };
  window.addEventListener('keydown', onKey, true);
  panel.addEventListener('click', e => {
    if (e.target === panel || e.target.closest('.check-close') || e.target.closest('a[href^="#"]')) close();
    const v = e.target.closest('[data-visitor]');
    if (v) { close(); onVisitor(v.dataset.visitor === 'on'); }
  });

  const body = panel.querySelector('.check-body');
  run().then(r => { body.innerHTML = render(r, href, visitor); },
    err => { body.innerHTML = `<p class="check-bad">${esc(t('checkp.failed', { error: err.message || String(err) }))}</p>`; });
  return close;
}

function render(r, href, visitor) {
  const exposed = r.pii.filter(p => p.exposed);
  const ok = !exposed.length;
  const link = p => (p.kind === 'slide' ? `<code>${esc(p.rel)}</code>` : `<a href="${href.edit(p.rel)}">${esc(p.title)}</a> <code>${esc(p.rel)}</code>`);
  const row = p => `<li>${link(p)}<span class="pii-badge ${p.exposed ? 'out' : 'in'}">${esc(t(p.exposed ? 'privacy.exposed' : 'privacy.hidden'))}</span>
    <ul class="pii-hits">${p.hits.map(h => `<li><em>${esc(t('privacy.kind.' + h.key))}</em><code>${esc(maskPII(h.key, h.match))}</code><small>${esc(t('privacy.line', { n: h.line }))}</small></li>`).join('')}</ul></li>`;
  return `
    <div class="check-summary ${ok ? 'good' : 'bad'}">
      <b>${esc(ok ? t('privacy.ok') : t('privacy.bad', { n: exposed.length }))}</b>
      <span>${esc(t('privacy.counts', r.counts))}</span>
    </div>
    <p class="privacy-rule">${esc(t('privacy.rule'))}</p>
    <div class="privacy-actions">
      <button class="btn ${visitor ? 'ghost' : 'primary'}" data-visitor="${visitor ? 'off' : 'on'}">${esc(t(visitor ? 'privacy.visitorOff' : 'privacy.visitorOn'))}</button>
      <small>${esc(t('privacy.visitorHint'))}</small>
    </div>
    ${r.pii.length ? `<h3>${esc(t('privacy.piiHeading'))}</h3><p class="privacy-note">${esc(t('privacy.piiNote'))}</p><ul class="check-problems pii">${r.pii.map(row).join('')}</ul>` : `<p class="check-empty">${esc(t('privacy.noPII'))}</p>`}
    <details class="privacy-public"><summary>${esc(t('privacy.publicList', { n: r.publicNotes.length }))}</summary>
      ${r.publicNotes.length ? `<ul>${r.publicNotes.map(n => `<li><a href="${href.note(n.rel)}">${esc(n.title)}</a> <code>${esc(n.rel)}</code></li>`).join('')}</ul>` : `<p class="check-empty">${esc(t('privacy.noPublic'))}</p>`}
    </details>`;
}
