// 主題管理的對話框:編輯主題、新增主題、管理分類。只回傳使用者填的值,寫檔由 main.js 做。
// 每個動作都分兩步:先填,再看「會改哪個檔案、改了什麼」的預覽,確認後才寫。

import { t } from '../core/i18n.js';
import { escapeHTML as esc } from '../core/markdown.js';
import { dialog } from './dialog.js';
import { topicIdError, validColor, categoryIdError } from '../core/topics.js';

const publicOptions = () => [
  { value: '', label: t('tm.publicUnset') },
  { value: 'true', label: t('tm.publicYes') },
  { value: 'false', label: t('tm.publicNo') },
];
const categoryOptions = cats => [{ value: '', label: t('tm.noCategory') }, ...cats.map(c => ({ value: c.id, label: c.name }))];
const toPublic = v => (v === 'true' ? true : v === 'false' ? false : '');

/**
 * 編輯或新增主題。填錯時留在對話框並顯示原因。
 * @param {{ mode: 'edit'|'new', id?: string, conf?: object, title?: string, categories: object[], ids?: string[], prefix?: string }} o
 * @returns {Promise<null | { id?: string, name, description, category, color, public }>}
 */
export async function topicDialog(o) {
  const conf = o.conf || {};
  let v = {
    id: o.prefix || '',
    name: o.title ?? String(conf.name ?? conf.title ?? ''),
    description: String(conf.description ?? ''),
    category: String(conf.category ?? ''),
    color: String(conf.color ?? ''),
    public: typeof conf.public === 'boolean' ? String(conf.public) : '',
  };
  let error = '';
  for (;;) {
    const r = await dialog({
      title: o.mode === 'new' ? t('tm.newTitle') : t('tm.editTitle', { name: v.name || o.id }),
      message: o.mode === 'new' ? t('tm.newHint') : t('tm.editHint', { path: `notes/${o.id}/_topic.yml` }),
      error,
      fields: [
        ...(o.mode === 'new' ? [{ name: 'id', label: t('tm.folder'), value: v.id, placeholder: '60-health' }] : []),
        { name: 'name', label: t('tm.name'), value: v.name },
        { name: 'description', label: t('tm.description'), value: v.description },
        { name: 'category', label: t('tm.category'), type: 'select', value: v.category, options: categoryOptions(o.categories) },
        { name: 'color', label: t('tm.color'), value: v.color, placeholder: '#4f73a6' },
        { name: 'public', label: t('tm.public'), type: 'select', value: v.public, options: publicOptions() },
      ],
      buttons: [{ label: t('dialog.cancel'), value: null }, { label: t('tm.next'), value: 'ok', primary: true }],
    });
    if (!r || r.value !== 'ok') return null;
    v = { ...v, ...r.fields };
    const f = { ...v, name: v.name.trim(), description: v.description.trim(), color: v.color.trim(), id: (v.id || '').trim() };
    if (o.mode === 'new') {
      const e = topicIdError(f.id, o.ids || []);
      if (e) { error = t('tm.idErr.' + e); continue; }
      if (!f.name) { error = t('tm.nameRequired'); continue; }
    }
    if (!validColor(f.color)) { error = t('tm.colorErr'); continue; }
    return { ...(o.mode === 'new' ? { id: f.id } : {}), name: f.name, description: f.description, category: f.category, color: f.color, public: toPublic(f.public) };
  }
}

/** 寫入前的預覽。lines 是「改了什麼」的清單。 */
export async function previewDialog({ title, path, lines, note = '', ok = t('tm.save') }) {
  const r = await dialog({
    title,
    message: t('tm.previewFile', { path }),
    list: lines,
    note,
    buttons: [{ label: t('tm.back'), value: null }, { label: ok, value: 'ok', primary: true }],
  });
  return r?.value === 'ok';
}

/** 一個欄位改動的說明文字。 */
export function describeChange(c, categories = []) {
  const label = { name: t('tm.name'), title: t('tm.name'), description: t('tm.description'), category: t('tm.category'), color: t('tm.color'), public: t('tm.public') }[c.key] || c.key;
  const show = (k, x) => {
    if (x === '' || x == null) return t('tm.unset');
    if (k === 'category') return categories.find(cat => cat.id === x)?.name || x;
    if (k === 'public') return t(x ? 'tm.publicYes' : 'tm.publicNo');
    return String(x);
  };
  return t('tm.change', { field: label, from: show(c.key, c.from), to: show(c.key, c.to) });
}

/**
 * 管理分類:改名、改色、上下移動、新增、刪除。回傳新的清單或 null(取消)。
 * used:分類 id → 用到它的主題數(有主題在用的不能刪)。
 */
export function categoriesDialog({ categories, used }) {
  return new Promise(resolve => {
    let list = categories.map(c => ({ ...c, isNew: false }));
    const box = document.createElement('div');
    box.className = 'lp-dialog';
    const render = (error = '') => {
      box.innerHTML = `<form class="lp-dialog-card tm-cats" role="dialog" aria-modal="true" aria-label="${esc(t('tm.catsTitle'))}">
        <h2>${esc(t('tm.catsTitle'))}</h2>
        <p>${esc(t('tm.catsHint'))}</p>
        <ol class="tm-cat-list">${list.map((c, i) => `<li data-i="${i}">
          <span class="tm-swatch" style="background:${validColor(c.color) && c.color ? esc(c.color) : 'transparent'}"></span>
          <span class="tm-cat-fields">
            <input name="name" value="${esc(c.name)}" aria-label="${esc(t('tm.catName'))}" placeholder="${esc(t('tm.catName'))}">
            <input name="color" value="${esc(c.color || '')}" aria-label="${esc(t('tm.color'))}" placeholder="#4f73a6" class="tm-color">
            ${c.isNew ? `<input name="id" value="${esc(c.id)}" aria-label="${esc(t('tm.catId'))}" placeholder="${esc(t('tm.catIdPh'))}" class="tm-id">` : `<code title="${esc(t('tm.catId'))}">${esc(c.id)}</code>`}
            <small>${esc(t('tm.catUsed', { n: used.get(c.id) || 0 }))}</small>
          </span>
          <span class="tm-cat-acts">
            <button type="button" data-a="up" aria-label="${esc(t('tm.up'))}" ${i ? '' : 'disabled'}>↑</button>
            <button type="button" data-a="down" aria-label="${esc(t('tm.down'))}" ${i < list.length - 1 ? '' : 'disabled'}>↓</button>
            <button type="button" data-a="del" aria-label="${esc(t('tm.delete'))}" title="${esc(used.get(c.id) ? t('tm.catInUse') : t('tm.delete'))}" ${used.get(c.id) ? 'disabled' : ''}>✕</button>
          </span>
        </li>`).join('')}</ol>
        <button type="button" class="btn ghost tm-add">${esc(t('tm.catAdd'))}</button>
        ${error ? `<p class="lp-dialog-error" role="alert">${esc(error)}</p>` : ''}
        <div class="lp-dialog-buttons"><button type="button" class="btn ghost" data-close>${esc(t('dialog.cancel'))}</button><button type="submit" class="btn primary">${esc(t('tm.next'))}</button></div>
      </form>`;
    };
    // 把畫面上的輸入讀回 list(重畫前要先做,才不會丟掉剛打的字)
    const sync = () => box.querySelectorAll('.tm-cat-list li').forEach(li => {
      const c = list[Number(li.dataset.i)];
      for (const el of li.querySelectorAll('input')) c[el.name] = el.value.trim();
    });
    const done = v => { window.removeEventListener('keydown', onKey, true); box.remove(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(null); } else e.stopImmediatePropagation(); };
    window.addEventListener('keydown', onKey, true);
    box.addEventListener('click', e => {
      if (e.target === box || e.target.closest('[data-close]')) return done(null);
      if (e.target.closest('.tm-add')) {
        sync(); list.push({ id: '', name: '', color: '', isNew: true }); render();
        return box.querySelector('.tm-cat-list li:last-child input')?.focus();
      }
      const a = e.target.closest('[data-a]');
      if (!a) return;
      sync();
      const i = Number(a.closest('li').dataset.i);
      if (a.dataset.a === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      if (a.dataset.a === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
      if (a.dataset.a === 'del') list.splice(i, 1);
      render();
      box.querySelector(`.tm-cat-list li[data-i="${Math.min(i + (a.dataset.a === 'down' ? 1 : a.dataset.a === 'up' ? -1 : 0), list.length - 1)}"] [data-a="${a.dataset.a}"]`)?.focus();
    });
    box.addEventListener('submit', e => {
      e.preventDefault();
      sync();
      const ids = [];
      for (const c of list) {
        if (!c.name) return render(t('tm.catNameRequired'));
        if (!validColor(c.color)) return render(t('tm.colorErr'));
        if (c.isNew) { const err = categoryIdError(c.id, [...ids, ...list.filter(x => !x.isNew).map(x => x.id)]); if (err) return render(t('tm.catIdErr.' + err, { id: c.id })); }
        ids.push(c.id);
      }
      done(list.map(c => ({ id: c.id, name: c.name, color: c.color || '' })));
    });
    render();
    document.body.append(box);
    requestAnimationFrame(() => box.querySelector('input')?.focus());
  });
}
