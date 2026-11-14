// 畫布的側邊卡片面板(參考 Heptabase):在畫布上點筆記卡,右邊直接閱讀與編輯,不用離開畫布。
//   - 閱讀:和筆記頁同一套 Markdown、[[連結]]、圖片;面板裡點 [[筆記]] 就在面板裡換頁,點簡報照常開啟。
//   - 編輯:可寫入的書庫才有。存檔前比對檔案狀態(別的程式改過就停下來問),沒存的內容存成草稿,
//     和筆記頁的編輯器共用同一份(到筆記頁的編輯器也找得回來)。
//   - 只寫 .md;刪除、改名、搬移不在這裡做。
//   - 訪客視角:看不到的筆記不顯示內文。

import { escapeHTML as esc, renderMarkdown } from '../core/markdown.js';
import { parseNote, linkLabel } from '../core/note.js';
import { hydrate } from '../player/hydrate.js';
import { t } from '../core/i18n.js';
import { noteMediaPath } from './notes/reader.js';
import { draftKey, writeDraft, dropDraft } from './notes/editor.js';
import { dialog, confirmDialog, toast } from './dialog.js';
import { attachSlash } from './slash-menu.js';
import { attachPaste } from './paste-md.js';

/**
 * @param {HTMLElement} box   面板的容器(畫布裡的 aside)
 * @param {object} o
 * @param {object} o.vault
 * @param {string} o.libId
 * @param {object} o.href                 hrefs(key):note、deck
 * @param {Promise<object>|null} o.graph
 * @param {(rel: string) => boolean} [o.visible]   訪客視角時,這篇看不看得到
 * @param {(rel: string|null) => void} [o.onChange] 面板換了筆記或關掉(更新網址、標出卡片)
 * @param {(rel: string) => boolean} [o.onBoard]    這篇是不是已經在畫布上
 * @param {(rel: string) => void} [o.addToBoard]    放到畫布
 * @param {() => void} [o.onSaved]                   存檔後(重建圖譜,卡片內容跟著更新)
 * @param {(rel: string) => void} [o.ask]            問 AI(這篇筆記,與畫布上連到它的卡片)
 */
export function createPeek(box, { vault, libId, href, graph, visible = () => true, onChange, onBoard = () => true, addToBoard = null, onSaved, ask = null }) {
  const source = vault.notesSource;
  const writable = !!source?.canWrite;
  let rel = null, mode = 'read', text = '', original = '', stat = null, saving = false, seq = 0, slash = null;

  const dirty = () => mode === 'edit' && text !== original;
  const ta = () => box.querySelector('.pk-text');

  box.addEventListener('pointerdown', e => e.stopPropagation());
  box.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
  box.addEventListener('contextmenu', e => e.stopPropagation());

  function head(title, { tools = true } = {}) {
    return `<div class="pk-head">
      <b class="pk-title">${esc(title)}</b>
      <span class="pk-tools">
        ${tools && mode === 'read' && writable ? `<button type="button" data-pk="edit" title="${esc(t('peek.editTitle'))}">${esc(t('peek.edit'))}</button>` : ''}
        ${tools && mode === 'edit' ? `<span class="pk-status" role="status"></span><button type="button" data-pk="cancel">${esc(t('dialog.cancel'))}</button><button type="button" class="primary" data-pk="save" title="${esc(t('ne.saveTitle'))}">${esc(t('ne.save'))}</button>` : ''}
        ${tools && mode === 'read' && rel && ask ? `<button type="button" data-pk="ask" title="${esc(t('ask.buttonTitle'))}">${esc(t('ask.button'))}</button>` : ''}
        ${tools && rel && addToBoard && !onBoard(rel) ? `<button type="button" data-pk="add" title="${esc(t('peek.addTitle'))}">${esc(t('peek.add'))}</button>` : ''}
        ${tools && rel ? `<a class="pk-page" href="${href.note(rel)}" title="${esc(t('peek.pageTitle'))}" aria-label="${esc(t('peek.pageTitle'))}">↗</a>` : ''}
        <button type="button" data-pk="close" aria-label="${esc(t('checkp.close'))}" title="${esc(t('peek.closeTitle'))}">×</button>
      </span>
    </div>`;
  }

  function renderRead(note) {
    const html = renderMarkdown(note.body, {
      image: (src, alt) => `<img data-media="${esc(noteMediaPath(src, rel))}" alt="${esc(alt)}" loading="lazy">`,
      wikilink: l => `<a class="wikilink${l.embed ? ' embed' : ''}${l.channel === 'slides' ? ' to-deck' : ''}" href="#" data-raw="${esc(JSON.stringify({ channel: l.channel, target: l.target, heading: l.heading }))}"${l.label ? '' : ' data-auto="1"'}>${esc(linkLabel(l))}</a>`,
    });
    const hasH1 = note.headings.some(h => h.level === 1);
    box.innerHTML = `${head(note.title)}
      <article class="pk-body note-article"${note.lang ? ` lang="${esc(note.lang)}"` : ''}>
        <div class="note-meta">${note.date ? `<span>${esc(note.date)}</span>` : ''}${note.tags.map(x => `<span class="tag">#${esc(x)}</span>`).join('')}</div>
        ${hasH1 ? '' : `<h1>${esc(note.title)}</h1>`}
        <div class="md">${html}</div>
      </article>`;
    hydrate(box.querySelector('.pk-body'), source);
    graph?.then(g => {
      if (!g || mode !== 'read') return;
      const me = vault.notePath(rel), topicId = g.notes.get(me)?.topicId;
      for (const a of box.querySelectorAll('a.wikilink[data-raw]')) {
        let l; try { l = JSON.parse(a.dataset.raw); } catch { continue; }
        const res = g.resolver.resolve(l, { fromTopic: topicId, fromPath: me });
        if (res.status === 'missing') { a.classList.add('missing'); a.title = t('note.linkMissing'); }
        else if (res.target) { a.title = res.target.title; if (a.dataset.auto) a.textContent = res.target.title + (l.heading ? ' › ' + l.heading : ''); }
      }
    }, () => {});
  }

  function renderEdit(note) {
    box.innerHTML = `${head(note.title)}
      <textarea class="pk-text" spellcheck="false" aria-label="${esc(t('ne.textLabel'))}"></textarea>`;
    const area = ta();
    area.value = text;
    slash = attachSlash(area);
    attachPaste(area);
    area.addEventListener('input', () => { text = area.value; writeDraft(draftKey(libId, rel), text); setStatus(); });
    area.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
    });
    setStatus();
    area.focus({ preventScroll: true });
  }

  function setStatus(msg) {
    const s = box.querySelector('.pk-status');
    if (s) s.textContent = msg ?? (dirty() ? t('ne.unsaved') : '');
  }

  function render() {
    slash?.dispose(); slash = null;
    const note = parseNote(text, { path: rel });
    if (mode === 'edit') renderEdit(note); else renderRead(note);
  }

  /** 開一篇筆記(rel = 筆記渠道裡的路徑)。有沒存的修改時先問。 */
  async function open(next, { force = false } = {}) {
    if (!next) return close();
    if (next === rel && !force) { box.hidden = false; return; }
    if (dirty() && !(await confirmDialog(t('ne.leaveAsk'), t('ne.leave')))) return;
    const my = ++seq;
    rel = next; mode = 'read'; stat = null;
    box.hidden = false;
    box.classList.add('loading');
    onChange?.(rel);
    if (!visible(rel)) {
      box.classList.remove('loading');
      box.innerHTML = `${head(t('privacy.hiddenTitle'), { tools: false })}<p class="pk-msg">${esc(t('privacy.hiddenText'))}</p>`;
      return;
    }
    try {
      const body = await source.readText(rel);
      if (my !== seq) return;
      text = original = body;
      render();
      box.querySelector('.pk-body')?.scrollTo(0, 0);
    } catch {
      if (my !== seq) return;
      box.innerHTML = `${head(rel.split('/').pop(), { tools: false })}<p class="pk-msg">${esc(t('peek.readFailed'))}</p>`;
    } finally { if (my === seq) box.classList.remove('loading'); }
  }

  async function close() {
    if (dirty() && !(await confirmDialog(t('ne.leaveAsk'), t('ne.leave')))) return false;
    seq++;
    slash?.dispose(); slash = null;
    rel = null; mode = 'read'; text = original = '';
    box.hidden = true;
    box.innerHTML = '';
    onChange?.(null);
    return true;
  }

  async function startEdit() {
    if (!writable || !rel) return;
    try { stat = await source.stat(rel); } catch { stat = null; }
    mode = 'edit';
    render();
  }

  async function cancelEdit() {
    if (dirty() && !(await confirmDialog(t('peek.discardAsk'), t('peek.discard')))) return;
    text = original; mode = 'read';
    dropDraft(draftKey(libId, rel));
    render();
  }

  async function save(force = false) {
    if (!writable || saving || mode !== 'edit') return;
    saving = true;
    setStatus(t('ne.saving'));
    try {
      stat = await source.writeText(rel, text, { expect: force ? undefined : stat });
      original = text;
      dropDraft(draftKey(libId, rel));
      toast(t('ne.savedToast'));
      mode = 'read';
      render();
      onSaved?.(rel);
    } catch (e) {
      if (e.message === 'stale') {
        const r = await dialog({
          title: t('ne.staleTitle'), message: t('ne.staleAsk'),
          buttons: [{ label: t('dialog.cancel'), value: 'cancel' }, { label: t('ne.staleReload'), value: 'reload' }, { label: t('ne.staleOverwrite'), value: 'overwrite', primary: true }],
        });
        saving = false;
        if (r?.value === 'overwrite') return save(true);
        if (r?.value === 'reload') {
          writeDraft(draftKey(libId, rel), text); // 自己的版本先留在草稿裡
          text = original = await source.readText(rel);
          stat = await source.stat(rel);
          render();
          toast(t('ne.reloadedKeptDraft'));
        } else setStatus();
        return;
      }
      setStatus(e.message === 'denied' ? t('ne.denied') : t('ne.saveFailed', { error: e.message || e }));
    } finally { saving = false; }
  }

  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-pk]');
    if (b) {
      const k = b.dataset.pk;
      if (k === 'close') return close();
      if (k === 'edit') return startEdit();
      if (k === 'cancel') return cancelEdit();
      if (k === 'save') return save();
      if (k === 'ask') return ask?.(rel);
      if (k === 'add') { addToBoard?.(rel); b.remove(); return; }
      return;
    }
    const a = e.target.closest('a.wikilink[data-raw]');
    if (!a) return;
    e.preventDefault();
    let l; try { l = JSON.parse(a.dataset.raw); } catch { return; }
    const g = await graph?.catch(() => null);
    if (!g) return toast(t('note.indexing'));
    const me = vault.notePath(rel);
    const res = g.resolver.resolve(l, { fromTopic: g.notes.get(me)?.topicId, fromPath: me });
    if (res.status === 'self') return;
    if (!res.target) return toast(t('note.linkMissingToast', { link: l.target }));
    if (res.status === 'ambiguous') toast(t('note.linkAmbiguousToast', { n: res.candidates.length }));
    if (res.target.kind !== 'note') { location.hash = href.deck(res.target.topicId, res.target.project.id); return; }
    open(res.target.rel);
  });

  return {
    open, close,
    get rel() { return rel; },
    isDirty: dirty,
    /** 卡片內容變了(例如圖譜重建):正在閱讀就重讀一次。 */
    refresh: () => { if (rel && mode === 'read') open(rel, { force: true }); },
  };
}
