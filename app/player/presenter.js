// 講者視窗:顯示目前投影片、下一張、備註、計時。與主視窗透過 BroadcastChannel 同步。
// 媒體網址由主視窗提供(本機檔案的 blob 網址在同網域的視窗間可以共用)。

import { escapeHTML as esc } from '../core/markdown.js';
import { applyTheme } from './themes.js';
import { t, setLang, getLang } from '../core/i18n.js';
import { Ink } from './ink.js';
import { loadQA, saveQA } from './qa-store.js';

export function startPresenter(root) {
  try { setLang(localStorage.getItem('leafpile-lang') || (navigator.language?.toLowerCase().startsWith('zh') ? 'zh-Hant' : 'en')); } catch { /* 隱私模式 */ }
  document.documentElement.lang = getLang();
  document.title = t('pv.docTitle');
  root.innerHTML = `
    <div class="presenter">
      <section class="pv-main">
        <div class="pv-label pv-ink-row"><span>${t('pv.current')}</span><span class="pv-ink">${['none', 'laser', 'pen', 'highlight', 'eraser'].map(k => `<button data-ink="${k}">${esc(t(k === 'none' ? 'pv.inkNone' : 'ink.' + k))}</button>`).join('')}<button data-ink="undo">${esc(t('ink.undo'))}</button><button data-ink="clear">${esc(t('ink.clear'))}</button></span></div>
        <div class="pv-box cur"><div class="pv-frame"></div></div>
        <div class="pv-ink-hint">${t('pv.inkHint')}</div>
      </section>
      <aside class="pv-side">
        <div class="pv-clock"><div><small>${t('pv.elapsed')}</small><b class="elapsed">00:00</b></div><div><small>${t('pv.now')}</small><b class="now">--:--</b></div><button class="reset">${t('pv.reset')}</button></div>
        <div class="pv-label">${t('pv.next')}</div><div class="pv-box next"><div class="pv-frame"></div></div>
        <div class="pv-meta"></div>
        <div class="pv-label pv-notes-row"><span class="pv-tabs" role="tablist"><button role="tab" data-tab="notes" class="on" aria-selected="true">${esc(t('pv.notes'))}</button><button role="tab" data-tab="qa" aria-selected="false" hidden>${esc(t('pv.qa'))} <b class="qa-count"></b></button></span><span class="pv-notes-tools"><span class="saved"></span><button class="pv-edit-notes" hidden>${esc(t('pv.editNotes'))}</button></span></div>
        <div class="pv-notes"><p class="empty">${t('pv.waiting')}</p></div>
        <div class="pv-qa" hidden>
          <form class="qa-add"><textarea rows="2" placeholder="${esc(t('pv.qaPlaceholder'))}"></textarea><button type="submit">${esc(t('pv.qaAdd'))}</button></form>
          <ol class="qa-list"></ol>
          <div class="qa-foot"><span>${esc(t('pv.qaHint'))}</span><button type="button" class="qa-download">${esc(t('pv.qaDownload'))}</button></div>
        </div>
        <div class="pv-keys">${t('pv.keys')}</div>
        <div class="pv-flash" role="status"></div>
      </aside>
    </div>`;
  const $ = s => root.querySelector(s);
  const ch = new BroadcastChannel('leafpile-presenter');
  let startedAt = Date.now();
  let flashTimer = 0;
  const flash = msg => {
    const el = root.querySelector('.pv-flash');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove('on'), 4000);
  };
  // 在講者視窗畫的內容同步到觀眾畫面,反過來也一樣
  const ink = new Ink({ onOp: op => ch.postMessage({ type: 'ink', op }), onChange: () => {
    root.querySelectorAll('.pv-ink [data-ink]').forEach(b => b.classList.toggle('on', b.dataset.ink === (ink.enabled ? ink.tool : 'none')));
  } });
  root.querySelector('.pv-ink').addEventListener('click', e => {
    const k = e.target.closest('[data-ink]')?.dataset.ink;
    if (!k) return;
    if (k === 'undo') return ink.undo();
    if (k === 'clear') return ink.clear();
    if (k === 'none') return ink.setEnabled(false);
    ink.setTool(k);
    ink.setEnabled(true);
  });

  const place = (box, html, media) => {
    const frame = box.querySelector('.pv-frame');
    frame.innerHTML = html || `<div class="pv-end">${t('pv.last')}</div>`;
    frame.querySelectorAll('[data-media]').forEach(el => { const u = media[el.dataset.media]; if (u) el.src = u; });
    frame.querySelectorAll('img[data-thumb]').forEach(el => { el.onerror = () => el.remove(); el.src = el.dataset.thumb; });
    frame.querySelectorAll('.slide[data-bg]').forEach(el => { const u = media[el.dataset.bg]; if (u) el.style.backgroundImage = `url("${u}")`; });
    const sc = box.clientWidth / 1280;
    frame.style.transform = `scale(${sc})`;
    box.style.height = `${720 * sc}px`;
  };

  // 備註可以直接在這裡改:主視窗負責寫檔(講者視窗碰不到資料夾)
  let editing = false, notesGi = -1;
  const btn = root.querySelector('.pv-edit-notes');
  const stopEditing = () => { editing = false; btn.textContent = t('pv.editNotes'); if (last) render(last); };
  btn.addEventListener('click', () => {
    if (!editing) {
      editing = true;
      notesGi = last?.gi ?? -1;
      btn.textContent = t('pv.saveNotes');
      const box = $('.pv-notes');
      box.innerHTML = '<textarea class="pv-notes-edit"></textarea>';
      box.querySelector('textarea').value = last?.notesText || '';
      box.querySelector('textarea').focus();
      box.querySelector('textarea').addEventListener('keydown', ev => {
        ev.stopPropagation();
        if ((ev.metaKey || ev.ctrlKey) && (ev.key === 's' || ev.key === 'S')) { ev.preventDefault(); btn.click(); }
        if (ev.key === 'Escape') stopEditing();
      });
      return;
    }
    const text = root.querySelector('.pv-notes-edit')?.value ?? '';
    root.querySelector('.saved').textContent = t('pv.savingNotes');
    ch.postMessage({ type: 'notes', gi: notesGi, text });
  });

  // ---------- 現場問答 ----------
  let qaKey = '', qa = [], tab = 'notes';
  const qaBox = $('.pv-qa'), qaList = $('.qa-list'), qaInput = $('.qa-add textarea');
  const setTab = name => {
    tab = name === 'qa' && qaKey ? 'qa' : 'notes';
    root.querySelectorAll('.pv-tabs [data-tab]').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    $('.pv-notes').hidden = tab !== 'notes';
    qaBox.hidden = tab !== 'qa';
    $('.pv-notes-tools').hidden = tab !== 'notes';
  };
  const persist = () => { if (!saveQA(qaKey, qa)) flash(t('pv.qaSaveFailed')); $('.qa-count').textContent = qa.length || ''; };
  const drawQA = () => {
    $('.qa-count').textContent = qa.length || '';
    qaList.innerHTML = qa.map((x, i) => `<li data-i="${i}"><div class="qa-q">${x.n ? `<span class="qa-n">${esc(t('pv.qaSlide', { n: x.n }))}</span>` : ''}${esc(x.q)}</div>`
      + `<textarea class="qa-a" rows="1" placeholder="${esc(t('pv.qaAnswer'))}">${esc(x.a || '')}</textarea>`
      + `<button type="button" class="qa-del">${esc(t('pv.qaDelete'))}</button></li>`).join('') || `<li class="empty">${esc(t('pv.qaEmpty'))}</li>`;
  };
  const setQAKey = key => {
    if (key === qaKey) return;
    qaKey = key || '';
    qa = loadQA(qaKey);
    root.querySelector('.pv-tabs [data-tab=qa]').hidden = !qaKey;
    drawQA();
    if (!qaKey) setTab('notes');
  };
  root.querySelector('.pv-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
  // 輸入框裡的按鍵不要傳到主視窗(否則打字會翻頁)
  qaBox.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.target.blur?.(); return; }
    if (e.target === qaInput && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('.qa-add').requestSubmit(); }
  });
  $('.qa-add').addEventListener('submit', e => {
    e.preventDefault();
    const q = qaInput.value.trim();
    if (!q || !qaKey) return;
    qa.push({ q, a: '', n: last?.n || undefined, at: new Date().toISOString() });
    qaInput.value = '';
    persist(); drawQA();
    qaList.lastElementChild?.scrollIntoView({ block: 'nearest' });
  });
  qaList.addEventListener('input', e => {
    const i = Number(e.target.closest('[data-i]')?.dataset.i);
    if (!e.target.matches('.qa-a') || !qa[i]) return;
    qa[i].a = e.target.value;
    persist();
  });
  qaList.addEventListener('click', e => {
    const b = e.target.closest('.qa-del');
    if (!b) return;
    // 現場手忙腳亂:要按兩次才刪除
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = t('pv.qaDeleteConfirm'); setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = t('pv.qaDelete'); } }, 3000); return; }
    qa.splice(Number(b.closest('[data-i]').dataset.i), 1);
    persist(); drawQA();
  });
  $('.qa-download').addEventListener('click', () => {
    if (!qa.length) return flash(t('pv.qaEmpty'));
    const url = URL.createObjectURL(new Blob([JSON.stringify(qa, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `qa-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  // 另一個講者視窗(或主視窗產生講後筆記後清空)改了紀錄:跟著更新
  window.addEventListener('storage', e => { if (qaKey && e.key === 'leafpile-qa:' + qaKey) { qa = loadQA(qaKey); drawQA(); } });

  let last = null;
  ch.onmessage = e => {
    if (e.data?.type === 'notesResult') {
      root.querySelector('.saved').textContent = e.data.ok ? t('pv.notesSaved') : t('pv.notesFailed');
      setTimeout(() => { root.querySelector('.saved').textContent = ''; }, 4000);
      if (e.data.ok) stopEditing();
      return;
    }
    const m = e.data;
    if (m?.type === 'ink' && m.op) return ink.apply(m.op);
    if (m?.type !== 'state') return;
    last = m;
    btn.hidden = !m.canEdit; // 只有能寫檔的來源才顯示「改備註」
    setQAKey(m.qaKey);
    if (editing && m.gi !== notesGi) stopEditing(); // 換張投影片就結束編輯
    applyTheme(m.theme);
    startedAt = m.startedAt || startedAt;
    place($('.pv-box.cur'), m.cur, m.media);
    ink.store.set(m.gi, m.ink || []);
    ink.mount($('.pv-box.cur .pv-frame'), m.gi);
    place($('.pv-box.next'), m.next, m.media);
    $('.pv-meta').innerHTML = `<b>${m.n}</b> / ${m.total} · ${esc(m.section || m.title)}${m.steps ? esc(t('pv.steps', { a: m.step, b: m.steps })) : ''}${m.viewing ? '' : t('pv.notViewing')}`;
    if (!editing) $('.pv-notes').innerHTML = m.notes || `<p class="empty">${t('pv.noNotes')}</p>`;
  };
  const render = m => { $('.pv-notes').innerHTML = m.notes || `<p class="empty">${t('pv.noNotes')}</p>`; };
  ch.postMessage({ type: 'hello' });

  window.addEventListener('keydown', e => {
    if (ink.enabled && (e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); return ink.undo(); }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // 瀏覽器只允許在觀眾畫面本身按鍵或點擊時進入全螢幕,講者視窗代按會被拒絕
    if (e.key === 'f' || e.key === 'F') { flash(t('pv.fullscreenHint')); return; }
    if ((e.key === 'q' || e.key === 'Q') && qaKey) { e.preventDefault(); setTab('qa'); qaInput.focus(); return; }
    ch.postMessage({ type: 'key', key: e.key });
    if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('resize', () => { if (last) ch.onmessage({ data: last }); });
  $('.pv-clock .reset').onclick = () => { startedAt = Date.now(); };
  const tick = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    $('.pv-clock .elapsed').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    $('.pv-clock .now').textContent = new Date().toLocaleTimeString(getLang() === 'en' ? 'en-GB' : 'zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  };
  tick();
  setInterval(tick, 1000);
}
