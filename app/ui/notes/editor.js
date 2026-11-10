// 筆記編輯:左邊 Markdown、右邊即時預覽。
//   - Ctrl/⌘+S 存檔;存檔前比對檔案狀態,別的程式改過就停下來問(沿用 Mdslide Pile 的寫入規則)
//   - 草稿保護:還沒存的內容每隔幾秒存到這台電腦的瀏覽器,下次打開會詢問要不要還原(沿用讀書筆記 Vault)
//   - 輸入 [[ 會列出筆記與簡報,Enter 插入
//   - 只寫 .md;刪除不在這裡做(封存才是唯一的刪除方式)

import { escapeHTML as esc, renderMarkdown } from '../../core/markdown.js';
import { linkLabel } from '../../core/note.js';
import { norm } from '../../core/links.js';
import { hydrate } from '../../player/hydrate.js';
import { applyUITheme } from '../../player/themes.js';
import { t } from '../../core/i18n.js';
import { noteMediaPath } from './reader.js';
import { dialog, confirmDialog, toast } from '../dialog.js';

const DRAFT_PREFIX = 'leafpile-draft:';

const draftKey = (libId, rel) => `${DRAFT_PREFIX}${libId}:${rel}`;
function readDraft(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function writeDraft(key, text) { try { localStorage.setItem(key, JSON.stringify({ text, at: Date.now() })); } catch { /* 空間不足或隱私模式 */ } }
function dropDraft(key) { try { localStorage.removeItem(key); } catch { /* 隱私模式 */ } }

/**
 * @param {HTMLElement} root
 * @param {{ vault, libId: string, rel: string, text: string, header: string, href: object, graph: Promise, onSaved?: Function }} opts
 * @returns {{ cleanup: Function, isDirty: () => boolean }}
 */
export function renderEditor(root, { vault, libId, rel, text, header, href, graph, onSaved }) {
  applyUITheme(vault.theme || 'paper');
  const source = vault.notesSource;
  const writable = !!source.canWrite;
  const ghEdit = (() => {
    const m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
    const repo = location.pathname.split('/').filter(Boolean)[0];
    return source.kind === 'repo' && m && repo ? `https://github.com/${m[1]}/${repo}/edit/main/${source.base || 'content/notes/'}${rel}` : '';
  })();
  const key = draftKey(libId, rel);
  const state = { original: text, stat: null, saving: false };

  root.innerHTML = `
    <div class="note-editor">
      ${header}
      <div class="ne-bar">
        <a class="btn ghost back" href="${href.note(rel)}">${esc(t('ne.back'))}</a>
        <div class="ne-path"><b>${esc(rel.split('/').pop())}</b><small>${esc(rel)}</small></div>
        <div class="ne-tools" role="toolbar" aria-label="${esc(t('ne.toolbar'))}">
          <button data-ins="bold" title="${esc(t('ne.bold'))}"><b>B</b></button>
          <button data-ins="h2" title="${esc(t('ne.heading'))}">H2</button>
          <button data-ins="list" title="${esc(t('ne.list'))}">•</button>
          <button data-ins="task" title="${esc(t('ne.task'))}">☐</button>
          <button data-ins="quote" title="${esc(t('ne.quote'))}">❝</button>
          <button data-ins="link" title="${esc(t('ne.link'))}">[[ ]]</button>
        </div>
        <span class="ne-status" role="status"></span>
        ${writable ? `<button class="btn primary save" title="${esc(t('ne.saveTitle'))}">${esc(t('ne.save'))}</button>` : ghEdit ? `<a class="btn primary" href="${esc(ghEdit)}" target="_blank" rel="noopener">${esc(t('ne.editOnGitHub'))}</a>` : ''}
      </div>
      ${writable ? '' : `<p class="ne-readonly">${esc(t(source.kind === 'repo' ? 'ne.readonlyRepo' : 'ne.readonly'))}</p>`}
      <div class="ne-panes">
        <textarea class="ne-text" spellcheck="false" aria-label="${esc(t('ne.textLabel'))}"${writable ? '' : ' readonly'}></textarea>
        <div class="ne-preview note-article"><div class="md"></div></div>
      </div>
      <div class="ne-suggest" hidden role="listbox" aria-label="${esc(t('ne.suggest'))}"></div>
    </div>`;

  const $ = s => root.querySelector(s);
  const ta = $('.ne-text'), md = $('.ne-preview .md'), status = $('.ne-status'), suggest = $('.ne-suggest');
  ta.value = text;
  const dirty = () => ta.value !== state.original;
  const setStatus = msg => { status.textContent = msg; };
  const refreshStatus = () => { setStatus(dirty() ? t('ne.unsaved') : t('ne.saved')); $('.save')?.classList.toggle('pulse', dirty()); };

  let timer = 0;
  const preview = () => {
    md.innerHTML = renderMarkdown(ta.value.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, ''), {
      image: (src, alt) => `<img data-media="${esc(noteMediaPath(src, rel))}" alt="${esc(alt)}">`,
      wikilink: l => `<span class="wikilink${l.embed ? ' embed' : ''}">${esc(linkLabel(l))}</span>`,
    });
    hydrate(md, source);
  };
  preview();
  refreshStatus();

  // 草稿:打開時若有比檔案新的草稿,詢問要不要還原
  const draft = writable ? readDraft(key) : null;
  if (draft && draft.text !== text) {
    dialog({
      title: t('ne.draftTitle'),
      message: t('ne.draftAsk', { time: new Date(draft.at).toLocaleString() }),
      buttons: [{ label: t('ne.draftDiscard'), value: false }, { label: t('ne.draftRestore'), value: true, primary: true }],
    }).then(r => {
      if (r?.value) { ta.value = draft.text; preview(); refreshStatus(); }
      else dropDraft(key);
    });
  }

  if (writable) source.stat(rel).then(s => { state.stat = s; });

  ta.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { preview(); if (writable) dirty() ? writeDraft(key, ta.value) : dropDraft(key); }, 250);
    refreshStatus();
    updateSuggest();
  });

  // ---------- 存檔 ----------
  async function save(force = false) {
    if (!writable || state.saving) return;
    state.saving = true;
    setStatus(t('ne.saving'));
    try {
      state.stat = await source.writeText(rel, ta.value, { expect: force ? undefined : state.stat });
      state.original = ta.value;
      dropDraft(key);
      refreshStatus();
      toast(t('ne.savedToast'));
      onSaved?.();
    } catch (e) {
      if (e.message === 'stale') {
        const r = await dialog({
          title: t('ne.staleTitle'), message: t('ne.staleAsk'),
          buttons: [{ label: t('dialog.cancel'), value: 'cancel' }, { label: t('ne.staleReload'), value: 'reload' }, { label: t('ne.staleOverwrite'), value: 'overwrite', primary: true }],
        });
        state.saving = false;
        if (r?.value === 'overwrite') return save(true);
        if (r?.value === 'reload') {
          writeDraft(key, ta.value); // 自己的版本先留在草稿裡,不會不見
          ta.value = state.original = await source.readText(rel);
          state.stat = await source.stat(rel);
          preview(); refreshStatus();
          toast(t('ne.reloadedKeptDraft'));
        } else refreshStatus();
        return;
      }
      setStatus(e.message === 'denied' ? t('ne.denied') : t('ne.saveFailed', { error: e.message || e }));
    } finally { state.saving = false; }
  }
  $('.save')?.addEventListener('click', () => save());

  // ---------- 插入 ----------
  function insert(textToInsert, selectFrom, selectTo) {
    ta.focus();
    const ok = document.execCommand?.('insertText', false, textToInsert); // 可以復原
    if (!ok) ta.setRangeText(textToInsert, ta.selectionStart, ta.selectionEnd, 'end');
    if (selectFrom != null) { const end = ta.selectionEnd; ta.setSelectionRange(end - textToInsert.length + selectFrom, end - textToInsert.length + selectTo); }
    ta.dispatchEvent(new Event('input'));
  }
  const lineStart = () => { const v = ta.value, i = ta.selectionStart; return v.lastIndexOf('\n', i - 1) + 1; };
  const prefixLine = p => { const s = lineStart(); ta.setSelectionRange(s, s); insert(p); };
  const ACTIONS = {
    bold: () => { const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd) || t('ne.boldSample'); insert(`**${sel}**`, 2, 2 + sel.length); },
    h2: () => prefixLine('## '),
    list: () => prefixLine('- '),
    task: () => prefixLine('- [ ] '),
    quote: () => prefixLine('> '),
    link: () => { insert('[[]]', 2, 2); updateSuggest(); },
  };
  root.querySelectorAll('[data-ins]').forEach(b => b.addEventListener('click', () => writable && ACTIONS[b.dataset.ins]()));

  // ---------- [[ 自動完成 ----------
  let records = [], picks = [], pickIndex = 0;
  graph?.then(g => { records = g.records; }, () => {});
  function updateSuggest() {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/\[\[([^[\]\n|#]*)$/);
    if (!m || !records.length) { suggest.hidden = true; return; }
    const q = norm(m[1].replace(/^slides:/i, ''));
    const deckOnly = /^slides:/i.test(m[1]);
    picks = records.filter(r => (!deckOnly || r.kind === 'deck') && (!q || norm(r.title).includes(q) || norm(r.rel).includes(q))).slice(0, 8);
    pickIndex = 0;
    suggest.hidden = !picks.length;
    suggest.innerHTML = picks.map((r, i) => `<button role="option" data-i="${i}" class="${i === 0 ? 'on' : ''}"><span>${r.kind === 'deck' ? '▦' : '¶'}</span><b>${esc(r.title)}</b><small>${esc(r.rel)}</small></button>`).join('');
  }
  function pick(i) {
    const r = picks[i];
    if (!r) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/\[\[([^[\]\n|#]*)$/);
    const name = (r.kind === 'deck' ? 'slides:' : '') + r.title;
    ta.setSelectionRange(ta.selectionStart - m[1].length, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    insert(after.startsWith(']]') ? name : name + ']]');
    if (after.startsWith(']]')) ta.setSelectionRange(ta.selectionStart + 2, ta.selectionStart + 2);
    suggest.hidden = true;
  }
  suggest.addEventListener('mousedown', e => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(Number(b.dataset.i)); } });
  ta.addEventListener('keydown', e => {
    if (!suggest.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        pickIndex = (pickIndex + (e.key === 'ArrowDown' ? 1 : -1) + picks.length) % picks.length;
        suggest.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === pickIndex));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(pickIndex); return; }
      if (e.key === 'Escape') { e.preventDefault(); suggest.hidden = true; return; }
    }
  });
  ta.addEventListener('blur', () => setTimeout(() => { suggest.hidden = true; }, 150));

  // ---------- 快捷鍵與離開保護 ----------
  const onKey = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && e.target === ta) { e.preventDefault(); ACTIONS.bold(); }
  };
  const onUnload = e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onUnload);
  $('.back').addEventListener('click', async e => {
    if (!dirty()) return;
    e.preventDefault();
    if (await confirmDialog(t('ne.leaveAsk'), t('ne.leave'))) { state.original = ta.value; location.hash = href.note(rel); }
  });
  requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(0, 0); });

  return {
    isDirty: dirty,
    cleanup: () => { clearTimeout(timer); window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); },
  };
}

/** 新筆記的檔名:日期 + 標題(去掉檔名不能用的字元)。 */
export function newNoteFileName(title, date = new Date().toISOString().slice(0, 10)) {
  const safe = String(title).trim().replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '').replace(/\s+/g, '-').slice(0, 60) || 'note';
  return `${date}-${safe}.md`;
}

/** 新筆記的內容。 */
export function newNoteText(title, date = new Date().toISOString().slice(0, 10)) {
  return `---\ntitle: ${/[:#'"[\]{},&*!|>%@`]/.test(title) ? JSON.stringify(title) : title}\ndate: ${date}\ntags: []\n---\n# ${title}\n\n`;
}
