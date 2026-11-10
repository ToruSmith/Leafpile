// 編輯模式:左邊改 Markdown 原文,右邊即時看結果。只在 Chrome / Edge 開啟的本機資料夾能存檔。
//
// 安全做法(見 app/sources/sources.js 的寫入規則):
//   - 一份一份檔案編輯,存檔前比對打開時的檔案狀態,別的程式改過就停下來問。
//   - 沒存的修改離開前會詢問;隨時可以「還原」回打開時的內容。
//   - 新增投影片會自動取下一個編號;「封存」是搬到 _封存/,不真的刪檔。
// 其他瀏覽器與倉庫模式只能看與下載(或到 GitHub 編輯)。

import { escapeHTML as esc } from '../core/markdown.js';
import { parseSlideFile, LAYOUTS } from '../core/slide.js';
import { renderSlide, measureOverflow } from './render.js';
import { hydrate, stopMedia } from './hydrate.js';
import { t } from '../core/i18n.js';
import { splitOrder } from '../core/names.js';

const PREVIEW_DELAY = 180;

/**
 * 檔案裡每一張投影片在原文中的位置,和 core/slide.js 的切法一致:
 * 先去掉開頭的 front matter,再依單獨一行的 `---` 切開(程式碼區塊裡的不算),空白段落略過。
 */
export function segmentRanges(text) {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const fm = src.match(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/);
  const offset = fm ? fm[0].length : 0;
  const lines = src.slice(offset).split('\n');
  const cuts = [];
  let fence = null;
  lines.forEach((line, i) => {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1];
    else if (!fence && /^---\s*$/.test(line)) cuts.push(i);
  });
  const bounds = [-1, ...cuts, lines.length];
  const at = n => offset + lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
  const out = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i] + 1, b = bounds[i + 1];
    if (bounds.length > 2 && !lines.slice(a, b).join('\n').trim()) continue; // 空白段落:和播放器一樣略過
    out.push({ from: at(a), to: Math.max(at(a), at(b) - 1) });
  }
  return out.length ? out : [{ from: offset, to: src.length }];
}

/** 下一個可用的檔名編號:01-x.md、02-y.md → 03。 */
export function nextName(names, title) {
  let max = 0;
  for (const n of names) {
    const m = n.match(/^(\d+)[-_. ]/);
    if (m) max = Math.max(max, +m[1]);
  }
  const num = String(max + 1).padStart(2, '0');
  const safe = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').trim().slice(0, 40);
  return `${num}-${safe || 'slide'}.md`;
}

const META_LINE = /^\s*<!--\s*([\w-]+)\s*:\s*(.*?)\s*-->\s*$/; // 和 core/slide.js 一致

/**
 * 設定第 index 張開頭的 `<!-- key: value -->`。value 為空字串就移除那一行。
 * 回傳 { text, from, to }:新的全文,以及被換掉的範圍(給編輯框用,才能保留復原紀錄)。
 */
export function setSegmentMeta(fileText, index, key, value) {
  const ranges = segmentRanges(fileText);
  const r = ranges[Math.min(index, ranges.length - 1)];
  const seg = fileText.slice(r.from, r.to);
  const lines = seg.split('\n');
  let i = 0, at = -1, lastMeta = -1;
  while (i < lines.length && (lines[i].trim() === '' || META_LINE.test(lines[i]))) {
    const m = lines[i].match(META_LINE);
    if (m) { lastMeta = i; if (m[1].toLowerCase() === key) at = i; }
    i++;
  }
  const line = `<!-- ${key}: ${value} -->`;
  let next;
  if (at >= 0) next = value ? lines.map((l, j) => (j === at ? line : l)) : lines.filter((_, j) => j !== at);
  else if (!value) return { text: fileText, from: r.from, to: r.from, replaced: '' };
  else {
    // 放在其他設定後面;沒有設定就放在這張第一個非空白行前面
    const pos = lastMeta >= 0 ? lastMeta + 1 : lines.findIndex(l => l.trim() !== '');
    next = [...lines];
    next.splice(pos < 0 ? 0 : pos, 0, line);
  }
  const replaced = next.join('\n');
  return { text: fileText.slice(0, r.from) + replaced + fileText.slice(r.to), from: r.from, to: r.to, replaced };
}

/**
 * 在第 index 張的設定區最後加一行 `<!-- line -->`(可以重複的設定,例如 mark)。
 * 回傳 { from, to, replaced, caret }:caret 是新的一行裡 ` -->` 之前的位置,方便接著打標籤。
 */
export function addSegmentMeta(fileText, index, line) {
  const ranges = segmentRanges(fileText);
  const r = ranges[Math.min(index, ranges.length - 1)];
  const seg = fileText.slice(r.from, r.to);
  const lines = seg.split('\n');
  let i = 0, lastMeta = -1;
  while (i < lines.length && (lines[i].trim() === '' || META_LINE.test(lines[i]))) { if (META_LINE.test(lines[i])) lastMeta = i; i++; }
  const pos = lastMeta >= 0 ? lastMeta + 1 : Math.max(0, lines.findIndex(l => l.trim() !== ''));
  const text = `<!-- ${line} -->`;
  const next = [...lines];
  next.splice(pos, 0, text);
  const replaced = next.join('\n');
  const caret = r.from + next.slice(0, pos).reduce((n, l) => n + l.length + 1, 0) + text.length - 4;
  return { from: r.from, to: r.to, replaced, caret };
}

/** 選取範圍涵蓋的整行一起縮排(outdent = 反縮排)。回傳要換上的文字與範圍。 */
export function indentLines(text, a, b, outdent = false, unit = '  ') {
  const from = text.lastIndexOf('\n', a - 1) + 1;
  let to = text.indexOf('\n', b > a && text[b - 1] === '\n' ? b - 1 : b);
  if (to < 0) to = text.length;
  const lines = text.slice(from, to).split('\n');
  const out = lines.map(l => (outdent ? l.replace(new RegExp(`^( {1,${unit.length}}|\\t)`), '') : unit + l));
  return { from, to, replaced: out.join('\n') };
}

/** 書庫裡可以插入的媒體檔(圖片、影片、網頁)。 */
const MEDIA_FILE = /\.(jpe?g|png|gif|webp|svg|avif|bmp|mp4|webm|mov|m4v|ogv|html?)$/i;

export function openEditor(player, { onSaved, onClose }) {
  const { source } = player;
  const canWrite = !!source.canWrite;
  const layoutOptions = LAYOUTS.filter(l => l !== 'title' && l !== 'section');
  const el = document.createElement('div');
  el.className = 'editor';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('editor.label'));
  el.innerHTML = `
    <header class="ebar">
      <button class="pbtn" data-e="close">${esc(t('editor.close'))}</button>
      <div class="enav">
        <button class="pbtn" data-e="prev" title="${esc(t('editor.prevTitle'))}" aria-label="${esc(t('editor.prevTitle'))}">‹</button>
        <span class="epos"></span>
        <button class="pbtn" data-e="next" title="${esc(t('editor.nextTitle'))}" aria-label="${esc(t('editor.nextTitle'))}">›</button>
      </div>
      <div class="efile"></div>
      <div class="egrow"></div>
      <button class="pbtn" data-e="add" title="${esc(t('editor.addTitle'))}">${esc(t('editor.add'))}</button>
      <button class="pbtn" data-e="archive" title="${esc(t('editor.archiveTitle'))}">${esc(t('editor.archive'))}</button>
      <a class="pbtn gh" hidden target="_blank" rel="noopener">${esc(t('editor.onGitHub'))}</a>
      <button class="pbtn" data-e="revert">${esc(t('editor.revert'))}</button>
      <button class="pbtn primary" data-e="save">${esc(t('editor.save'))}</button>
    </header>
    <div class="etools" role="toolbar" aria-label="${esc(t('editor.tools'))}">
      <label class="elayout">${esc(t('editor.layout'))}
        <select data-t="layout">${layoutOptions.map(l => `<option value="${l}">${esc(t('layoutName.' + l))}</option>`).join('')}</select>
      </label>
      <span class="esep"></span>
      <button data-t="heading" title="${esc(t('editor.tHeadingTitle'))}">${esc(t('editor.tHeading'))}</button>
      <button data-t="bold" title="${esc(t('editor.tBoldTitle'))}"><b>${esc(t('editor.tBold'))}</b></button>
      <button data-t="list" title="${esc(t('editor.tListTitle'))}">${esc(t('editor.tList'))}</button>
      <button data-t="media" title="${esc(t('editor.tMediaTitle'))}">${esc(t('editor.tMedia'))} ▾</button>
      <button data-t="columns" title="${esc(t('editor.tColumnsTitle'))}">${esc(t('editor.tColumns'))}</button>
      <button data-t="split" title="${esc(t('editor.tSplitTitle'))}">${esc(t('editor.tSplit'))}</button>
      <button data-t="notes" title="${esc(t('editor.tNotesTitle'))}">${esc(t('editor.tNotes'))}</button>
      <span class="esep"></span>
      <button data-t="look" class="elook" title="${esc(t('editor.lookTitle'))}">${esc(t('editor.look'))} ▾</button>
      <a class="ehelp" href="${esc(t('editor.guideURL'))}" target="_blank" rel="noopener">${esc(t('editor.guide'))}</a>
      <div class="emedia" hidden></div>
      <div class="esettings" hidden></div>
    </div>
    <div class="ebody">
      <div class="epane">
        <textarea class="etext" spellcheck="false" aria-label="${esc(t('editor.label'))}"></textarea>
        <div class="estatus"></div>
      </div>
      <div class="epane epreview"><div class="eslide"><div class="escale"></div></div><div class="eissues"></div></div>
    </div>`;
  player.el.player.append(el);
  const $ = s => el.querySelector(s);
  const ta = $('.etext');
  const state = { path: null, stat: null, original: '', seg: 0 };

  const dirty = () => ta.value !== state.original;
  const isYaml = () => /\.ya?ml$/i.test(state.path || '');
  const setStatus = (msg, kind = '') => { $('.estatus').textContent = msg; $('.estatus').className = `estatus ${kind}`; };

  // ---- 對話框:取代瀏覽器的 prompt / confirm,留在編輯畫面裡 ----
  /** buttons: [{ label, value, primary }];input = 預設文字(有值就顯示輸入框)。按 Esc = 最後一個按鈕。 */
  function ask(message, { buttons, input = null } = {}) {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.className = 'edialog';
      box.innerHTML = `<form class="edialog-card"><p></p>${input != null ? '<input type="text">' : ''}<div class="edialog-btns">${buttons.map((b, i) => `<button type="${b.primary ? 'submit' : 'button'}" class="pbtn${b.primary ? ' primary' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></form>`;
      box.querySelector('p').textContent = message;
      const field = box.querySelector('input');
      if (field) field.value = input;
      const finish = v => { box.remove(); ta.focus(); resolve(v); };
      const valueOf = b => (field && b.value === true ? field.value : b.value);
      box.addEventListener('click', e => { const i = e.target.closest('[data-i]')?.dataset.i; if (i != null && e.target.type !== 'submit') finish(valueOf(buttons[+i])); });
      box.querySelector('form').addEventListener('submit', e => { e.preventDefault(); finish(valueOf(buttons.find(b => b.primary))); });
      box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); finish(buttons[buttons.length - 1].value); } });
      el.append(box);
      (field || box.querySelector('.primary') || box.querySelector('button')).focus();
      field?.select();
    });
  }
  const confirmBox = (message, okLabel = t('editor.ok')) => ask(message, { buttons: [{ label: okLabel, value: true, primary: true }, { label: t('editor.cancel'), value: false }] });

  // ---- 編輯框:用 insertText 修改,Ctrl+Z 才復原得回來 ----
  function replaceRange(from, to, text, select = 'end') {
    ta.focus();
    ta.setSelectionRange(from, to);
    const ok = document.execCommand?.('insertText', false, text);
    if (!ok || ta.value.slice(from, from + text.length) !== text) ta.setRangeText(text, from, to, 'end'); // 舊瀏覽器退路(不能復原)
    if (select === 'all') ta.setSelectionRange(from, from + text.length);
    else if (Array.isArray(select)) ta.setSelectionRange(from + select[0], from + select[1]);
    ta.dispatchEvent(new Event('input'));
  }
  const insert = (text, select) => replaceRange(ta.selectionStart, ta.selectionEnd, text, select);

  // 倉庫模式(網站內建書庫)不能存檔,但可以直接到 GitHub 上編輯
  const ghBase = (() => {
    const m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
    const repo = location.pathname.split('/').filter(Boolean)[0];
    return source.kind === 'repo' && m && repo ? `https://github.com/${m[1]}/${repo}/edit/main/${source.base || 'content/'}` : '';
  })();

  const scale = () => el.style.setProperty('--es', ($('.eslide').clientWidth || 1280) / 1280);
  const ro = new ResizeObserver(scale);
  ro.observe($('.eslide'));

  /** 目前這一段對應到播放器裡的第幾張(找不到就維持原本的)。 */
  function globalIndex() {
    const ranges = segmentRanges(ta.value); // 依游標即時計算,不等預覽更新
    state.seg = Math.max(0, ranges.findIndex(r => ta.selectionStart <= r.to));
    const gi = player.slides.findIndex(sl => sl.file === state.path && sl.index === state.seg);
    return gi >= 0 ? gi : player.focus; // deck.yml(自動產生的頁面)或隱藏的張:維持原本的位置
  }
  function updatePosition() {
    const gi = globalIndex();
    $('.epos').textContent = t('editor.position', { n: gi + 1, total: player.slides.length });
    const count = isYaml() ? 1 : segmentRanges(ta.value).length;
    const after = player.slides.slice(gi + 1).some(sl => player.editTarget(player.slides.indexOf(sl))?.path !== state.path);
    const before = player.slides.slice(0, gi).some(sl => player.editTarget(player.slides.indexOf(sl))?.path !== state.path);
    $('[data-e="prev"]').disabled = state.seg <= 0 && !before;
    $('[data-e="next"]').disabled = state.seg >= count - 1 && !after;
    if (gi !== player.focus) player.goTo(gi); // 背後的播放器跟著,關掉編輯時就停在這一張
  }

  /** 重畫右邊:目前游標所在的那一段(檔案裡可能有好幾張)。 */
  let timer = 0;
  function preview() {
    const text = ta.value;
    const ranges = segmentRanges(text);
    const caret = ta.selectionStart;
    state.seg = Math.max(0, ranges.findIndex(r => caret <= r.to));
    $('.etools').classList.toggle('off', isYaml());
    if (isYaml()) { $('.escale').innerHTML = ''; $('.eissues').innerHTML = `<p>${esc(t('editor.yamlNote'))}</p>`; updatePosition(); return; }
    let slides = [], issues = [];
    try {
      const parsed = parseSlideFile(text, { path: state.path || 'untitled.md' });
      slides = parsed.slides;
      issues = parsed.issues || [];
    } catch (e) {
      issues = [{ message: String(e.message || e) }];
    }
    const slide = slides[Math.min(state.seg, slides.length - 1)];
    const box = $('.escale');
    stopMedia(box);
    box.innerHTML = slide ? renderSlide({ ...slide, sec: player.slides[player.focus]?.sec ?? 0 }, { deck: player.deck, mode: 'full', globalIndex: player.focus, total: player.slides.length }) : '';
    hydrate(box, source, { full: false });
    state.slide = slide;
    if (!$('.esettings').hidden) fillLook();
    const sel = $('[data-t="layout"]');
    const explicit = String(slide?.meta?.layout || 'auto').toLowerCase();
    sel.value = layoutOptions.includes(explicit) ? explicit : 'auto';
    sel.title = explicit === 'auto' && slide ? t('editor.layoutAuto', { name: t('layoutName.' + slide.layout) }) : '';
    const canMark = slide?.media[0]?.kind === 'image' && ['full', 'split', 'split-left', 'gallery'].includes(slide.layout);
    const extra = [slides.length > 1 ? t('editor.segment', { n: state.seg + 1, total: slides.length }) : '', canMark ? t('editor.markHint') : ''].filter(Boolean).join(' · ');
    $('.eissues').innerHTML = [...issues.map(i => `<p class="warn">${esc(i.message)}</p>`), extra ? `<p>${esc(extra)}</p>` : ''].join('');
    // 內容超出投影片:下面會被切掉,提醒拆張或改用緊湊
    requestAnimationFrame(() => {
      const over = box.firstElementChild ? measureOverflow(box.firstElementChild) : 0;
      $('.eissues .overflow')?.remove();
      if (over) $('.eissues').insertAdjacentHTML('afterbegin', `<p class="warn overflow">${esc(t(/^(small|compact)$/i.test(String(slide?.style?.size || player.deck.size || '')) ? 'editor.overflowCompact' : 'editor.overflow', { px: over }))}</p>`);
    });
    updatePosition();
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(preview, PREVIEW_DELAY); };

  // ---- 截圖標註:在預覽的主要圖片上拖曳,插入一行 <!-- mark: 左 上 寬 高 --> ----
  /** 圖片在畫面上實際顯示的範圍(考慮 contain / cover 的縮放與裁切)。 */
  function shownRect(img) {
    const r = img.getBoundingClientRect();
    const fit = getComputedStyle(img).objectFit;
    const k = (fit === 'cover' ? Math.max : Math.min)(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h, clip: r };
  }
  $('.eslide').addEventListener('pointerdown', e => {
    const img = e.target.closest?.('figure.media img');
    const first = $('.escale figure.media img');
    if (!img || img !== first || !img.naturalWidth || isYaml()) return;
    e.preventDefault();
    const area = shownRect(img);
    const host = $('.eslide').getBoundingClientRect();
    const rect = document.createElement('div');
    rect.className = 'edraw';
    $('.eslide').append(rect);
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const pt = ev => ({ x: clamp(ev.clientX, area.clip.left, area.clip.right), y: clamp(ev.clientY, area.clip.top, area.clip.bottom) });
    const p0 = pt(e);
    let p1 = p0;
    const draw = () => Object.assign(rect.style, { left: `${Math.min(p0.x, p1.x) - host.left}px`, top: `${Math.min(p0.y, p1.y) - host.top}px`, width: `${Math.abs(p1.x - p0.x)}px`, height: `${Math.abs(p1.y - p0.y)}px` });
    const move = ev => { p1 = pt(ev); draw(); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      rect.remove();
      const pc = (v, a, len) => Math.round(clamp((v - a) / len * 100, 0, 100));
      const x = pc(Math.min(p0.x, p1.x), area.left, area.width), y = pc(Math.min(p0.y, p1.y), area.top, area.height);
      const w = Math.min(100 - x, pc(Math.max(p0.x, p1.x), area.left, area.width) - x), h = Math.min(100 - y, pc(Math.max(p0.y, p1.y), area.top, area.height) - y);
      if (w < 2 || h < 2) return; // 只是點一下,不是拖曳
      const r = addSegmentMeta(ta.value, state.seg, `mark: ${x} ${y} ${w} ${h} `);
      replaceRange(r.from, r.to, r.replaced, 'end');
      ta.setSelectionRange(r.caret, r.caret); // 游標停在標籤的位置,直接打字
      setStatus(t('editor.markAdded'), 'ok');
      preview();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  /** 打開某一個檔案。segment = 要先顯示檔案裡的第幾張。 */
  async function load(path, { segment = 0, note = '', kind = 'warn' } = {}) {
    if (!(await confirmLeave())) return false;
    let text;
    try {
      text = await source.readText(path);
    } catch {
      setStatus(t('editor.openFailed', { path }), 'warn');
      return false;
    }
    state.path = path;
    state.original = text;
    state.stat = source.stat ? await source.stat(path) : null;
    ta.value = text;
    ta.scrollTop = 0;
    moveTo(segment);
    $('.efile').textContent = path;
    $('.ebar').dataset.yaml = isYaml() ? '1' : ''; // deck.yml:不提供新增 / 封存
    const gh = $('.gh');
    gh.hidden = !ghBase;
    if (ghBase) gh.href = ghBase + path.split('/').map(encodeURIComponent).join('/');
    setStatus(note || (canWrite ? t('editor.ready') : t('editor.readOnly')), note ? kind : '');
    preview();
    ta.focus();
    return true;
  }

  /** 游標移到這個檔案的第 segment 張開頭,並捲到看得見的地方。 */
  function moveTo(segment) {
    const at = segmentRanges(ta.value)[segment]?.from ?? 0;
    ta.setSelectionRange(at, at);
    const line = ta.value.slice(0, at).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 3);
  }

  /** 上一張 / 下一張:這個檔案裡還有就移動游標(以編輯框目前的內容為準,剛加或剛刪的 --- 也算),
   *  沒有了就(先存檔再)打開前後的檔案。 */
  async function step(d) {
    let gi = globalIndex();
    const count = segmentRanges(ta.value).length;
    if (!isYaml() && state.seg + d >= 0 && state.seg + d < count) { moveTo(state.seg + d); preview(); ta.focus(); return; }
    gi += d;
    while (player.editTarget(gi)?.path === state.path) gi += d; // 跳過同一個檔案的其他張
    const target = player.editTarget(gi);
    if (!target) return;
    let saved = '';
    if (dirty() && canWrite) { // 換檔前自動存檔,不必每次都問
      await save();
      if (dirty()) return; // 沒存成功(例如被別的程式改過):留在這裡
      saved = state.path.split('/').pop();
    }
    const note = target.auto ? t('editor.autoSlide') : saved ? t('editor.autoSaved', { name: saved }) : '';
    if (await load(target.path, { segment: target.segment, note, kind: target.auto ? 'warn' : 'ok' })) { player.goTo(gi); updatePosition(); }
  }

  async function save() {
    if (!canWrite) return download();
    if (!dirty()) return setStatus(t('editor.noChange'));
    setStatus(t('editor.saving'));
    try {
      state.stat = await source.writeText(state.path, ta.value, { expect: state.stat });
      state.original = ta.value;
      setStatus(t('editor.saved', { time: new Date().toLocaleTimeString() }), 'ok');
      await onSaved?.();
      updatePosition();
    } catch (e) {
      const m = String(e.message || e);
      if (m === 'stale') {
        // 別的程式改過這個檔案:讓使用者選,不自動蓋掉
        const over = await ask(t('editor.staleAsk'), { buttons: [{ label: t('editor.overwrite'), value: true }, { label: t('editor.keepTheirs'), value: false, primary: true }] });
        if (over) { state.stat = await source.stat(state.path); return save(); }
        setStatus(t('editor.staleKept'), 'warn');
      } else if (m === 'denied') setStatus(t('editor.denied'), 'warn');
      else setStatus(t('editor.failed', { message: m }), 'warn');
    }
  }

  /** 不能存檔時的退路:下載這個檔案。 */
  function download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ta.value], { type: 'text/markdown;charset=utf-8' }));
    a.download = state.path.split('/').pop();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    setStatus(t('editor.downloaded'), 'ok');
  }

  async function addSlide() {
    if (!canWrite) return setStatus(t('editor.readOnly'), 'warn');
    if (!(await confirmLeave())) return;
    const dir = state.path.slice(0, state.path.lastIndexOf('/'));
    const names = (await source.list(dir)).filter(e => e.kind === 'file').map(e => e.name);
    const title = await ask(t('editor.addAsk'), { input: '', buttons: [{ label: t('editor.add'), value: true, primary: true }, { label: t('editor.cancel'), value: null }] });
    if (title === null) return;
    const name = nextName(names, title);
    const path = `${dir}/${name}`;
    try {
      await source.writeText(path, `# ${title || splitOrder(name).label}\n`);
      await onSaved?.();
      setStatus(t('editor.added', { name }), 'ok');
      await load(path);
      ta.setSelectionRange(ta.value.length, ta.value.length);
    } catch (e) {
      setStatus(t('editor.failed', { message: String(e.message || e) }), 'warn');
    }
  }

  async function archive() {
    if (!canWrite) return setStatus(t('editor.readOnly'), 'warn');
    if (!(await confirmBox(t('editor.archiveAsk', { name: state.path.split('/').pop() }), t('editor.archive')))) return;
    try {
      // Leafpile:封存一律搬到書庫根目錄的 _archive/(由資料來源決定位置;Mdslide 書庫則放在簡報資料夾下)
      const to = await source.archive(state.path, `${player.deck.path}/_archive`);
      state.original = ta.value; // 已經搬走,不要再問未存檔
      setStatus(t('editor.archived', { path: to }), 'ok');
      await onSaved?.();
      close();
    } catch (e) {
      setStatus(t('editor.failed', { message: String(e.message || e) }), 'warn');
    }
  }

  /** 有未存檔的修改時問一次:能存檔就提供「儲存」,不然只能放棄或留下。 */
  async function confirmLeave() {
    if (!dirty()) return true;
    const buttons = canWrite
      ? [{ label: t('editor.save'), value: 'save', primary: true }, { label: t('editor.discard'), value: 'discard' }, { label: t('editor.cancel'), value: 'cancel' }]
      : [{ label: t('editor.discard'), value: 'discard', primary: true }, { label: t('editor.cancel'), value: 'cancel' }];
    const v = await ask(t('editor.unsavedAsk'), { buttons });
    if (v === 'save') { await save(); return !dirty(); }
    return v === 'discard';
  }

  async function close() {
    if (!(await confirmLeave())) return;
    ro.disconnect();
    stopMedia(el);
    el.remove();
    onClose?.();
  }

  // ---- 插入工具列 ----
  const lineStart = i => ta.value.lastIndexOf('\n', i - 1) + 1;
  async function tool(k) {
    const { selectionStart: a, selectionEnd: b } = ta;
    const sel = ta.value.slice(a, b);
    if (k === 'heading') {
      const s0 = lineStart(a);
      const line = ta.value.slice(s0, ta.value.indexOf('\n', s0) < 0 ? ta.value.length : ta.value.indexOf('\n', s0));
      const m = line.match(/^(#{1,3})\s+/);
      const next = !m ? '# ' : m[1].length < 3 ? '#'.repeat(m[1].length + 1) + ' ' : ''; // # → ## → ### → 一般文字
      replaceRange(s0, s0 + (m ? m[0].length : 0), next);
    }
    if (k === 'bold') {
      const word = sel || t('editor.sampleBold');
      insert(`**${word}**`, [2, 2 + word.length]);
    }
    if (k === 'list') {
      const s0 = lineStart(a);
      const e0 = b > a ? b : (ta.value.indexOf('\n', a) < 0 ? ta.value.length : ta.value.indexOf('\n', a));
      const block = ta.value.slice(s0, e0);
      const allList = block.split('\n').every(l => /^\s*[-*+]\s/.test(l) || !l.trim());
      const out = block.split('\n').map(l => (!l.trim() ? l : allList ? l.replace(/^(\s*)[-*+]\s/, '$1') : l.replace(/^(\s*)/, '$1- '))).join('\n');
      replaceRange(s0, e0, out || '- ', 'end');
    }
    if (k === 'columns') insert(`\n+++\n`);
    if (k === 'split') {
      const before = ta.value.slice(0, a);
      const pad = before.endsWith('\n\n') || !before ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const head = t('editor.sampleTitle');
      insert(`${pad}---\n\n# ${head}\n`, [pad.length + 7, pad.length + 7 + head.length]);
    }
    if (k === 'notes') {
      const r = segmentRanges(ta.value)[state.seg];
      const seg = ta.value.slice(r.from, r.to);
      const m = seg.match(/^\s*(?:note|notes|備註|講者備註)\s*[:：].*$/im); // i18n-ok:語法關鍵字
      if (m) { const at = r.from + m.index + m[0].length; ta.focus(); ta.setSelectionRange(at, at); return; }
      const trimmed = seg.replace(/\s+$/, '');
      replaceRange(r.from + trimmed.length, r.to, `\n\nNote:\n`);
    }
    if (k === 'media') return toggleMedia();
    if (k === 'look') { const box = $('.esettings'); box.hidden = !box.hidden; if (!box.hidden) fillLook(); return; }
    schedule();
  }

  // ---- 外觀設定面板:不用記設定名稱,選了就寫成這一張開頭的 <!-- 設定 --> ----
  const FONTS = ['Noto Sans TC', 'Noto Serif TC', 'Microsoft JhengHei', 'PingFang TC', 'DFKai-SB', 'Arial', 'Georgia', 'system-ui'];
  const RATIOS = ['', '1:1', '2:1', '1:2', '3:2', '2:3', '1:1:2', '2:1:1'];
  const hex = v => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : /^#[0-9a-f]{3}$/i.test(String(v || '')) ? '#' + String(v).slice(1).replace(/./g, c => c + c) : '');
  function fillLook() {
    const m = state.slide?.meta || {};
    const st = state.slide?.style || {};
    const lay = state.slide?.layout || 'text';
    const opt = (key, list) => list.map(([v, label]) => `<option value="${esc(v)}"${String(m[key] ?? '') === v ? ' selected' : ''}>${esc(label)}</option>`).join('');
    const colorRow = (key, label, value) => `<div class="erow"><label>${esc(label)}</label><span class="ecolor"><input type="color" data-look="${key}" value="${esc(hex(value) || '#888888')}"${hex(value) ? '' : ' class="unset"'}><code>${esc(value || t('editor.lookDefault'))}</code>${value ? `<button data-clear="${key}">${esc(t('editor.lookClear'))}</button>` : ''}</span></div>`;
    const ratioOK = ['split', 'split-left', 'columns', 'grid', 'gallery'].includes(lay);
    $('.esettings').innerHTML = `
      <div class="erow"><label>${esc(t('editor.lookSize'))}</label><select data-look="size">${opt('size', [['', t('editor.lookDefault')], ['small', t('editor.sizeSmall')], ['normal', t('editor.sizeNormal')], ['large', t('editor.sizeLarge')], ['xl', t('editor.sizeXl')]])}</select></div>
      ${colorRow('background', t('editor.lookBgColor'), st.bgColor)}
      <div class="erow"><label>${esc(t('editor.lookBgImage'))}</label><span><code>${esc(st.bgImage || t('editor.lookNone'))}</code> <button data-pickbg>${esc(t('editor.lookPick'))}</button>${st.bgImage ? ` <button data-clear="background">${esc(t('editor.lookClear'))}</button>` : ''}</span></div>
      <div class="erow"${st.bgImage ? '' : ' hidden'}><label>${esc(t('editor.lookOverlay'))}</label><select data-look="overlay">${opt('overlay', [['', t('editor.lookDefault')], ['dark', t('editor.overlayDark')], ['light', t('editor.overlayLight')], ['none', t('editor.overlayNone')]])}</select></div>
      ${colorRow('color', t('editor.lookAccent'), m.color)}
      ${colorRow('text', t('editor.lookText'), st.text)}
      <div class="erow"><label>${esc(t('editor.lookFont'))}</label><span><input type="text" data-look="font" list="efonts" value="${esc(m.font ?? '')}" placeholder="${esc(t('editor.lookDefault'))}"><datalist id="efonts">${FONTS.map(f => `<option value="${f}">`).join('')}</datalist></span></div>
      <div class="erow"><label>${esc(t('editor.lookAlign'))}</label><select data-look="align">${opt('align', [['', t('editor.lookDefault')], ['left', t('editor.alignLeft')], ['center', t('editor.alignCenter')], ['right', t('editor.alignRight')]])}</select></div>
      <div class="erow"${ratioOK ? '' : ' hidden'}><label>${esc(t('editor.lookRatio'))}</label><select data-look="ratio">${RATIOS.map(v => `<option value="${v}"${String(m.ratio ?? '') === v ? ' selected' : ''}>${esc(v || t('editor.lookDefault'))}</option>`).join('')}</select></div>
      <div class="erow checks">
        <label><input type="checkbox" data-flag="step"${m.step === true ? ' checked' : ''}> ${esc(t('editor.lookStep'))}</label>
        <label><input type="checkbox" data-flag="hidden"${m.hidden === true ? ' checked' : ''}> ${esc(t('editor.lookHidden'))}</label>
        <label><input type="checkbox" data-flag="footer"${m.footer === false ? '' : ' checked'}> ${esc(t('editor.lookFooter'))}</label>
      </div>
      <p class="enote">${esc(t('editor.lookNote'))}</p>`;
  }
  function setMeta(key, value) {
    const r = setSegmentMeta(ta.value, state.seg, key, value);
    if (r.text === ta.value) return;
    const caret = ta.selectionStart;
    replaceRange(r.from, r.to, r.replaced, 'end');
    const at = caret >= r.from ? Math.max(r.from, caret + r.replaced.length - (r.to - r.from)) : caret;
    ta.setSelectionRange(at, at);
    preview();
  }
  $('.esettings').addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.look) setMeta(el.dataset.look, el.value.trim());
    if (el.dataset.flag === 'footer') setMeta('footer', el.checked ? '' : 'false');
    else if (el.dataset.flag) setMeta(el.dataset.flag, el.checked ? 'true' : '');
  });
  $('.esettings').addEventListener('click', async e => {
    const c = e.target.closest('[data-clear]')?.dataset.clear;
    if (c) setMeta(c, '');
    if (e.target.closest('[data-pickbg]')) { state.pickBg = true; await toggleMedia(); }
  });

  async function toggleMedia() {
    const box = $('.emedia');
    if (!box.hidden) { box.hidden = true; return; }
    box.innerHTML = `<p>${esc(t('editor.mediaLoading'))}</p>`;
    box.hidden = false;
    const deckPath = player.deck.path;
    const dir = state.path.slice(0, state.path.lastIndexOf('/'));
    const found = [];
    const scan = async (path, prefix) => {
      try {
        for (const e of await source.list(path)) if (e.kind === 'file' && MEDIA_FILE.test(e.name)) found.push(prefix + e.name);
      } catch { /* 沒有這個資料夾 */ }
    };
    await scan(`${deckPath}/media`, 'media/');
    if (dir !== deckPath) await scan(dir, './');
    const items = found.slice(0, 60).map(f => `<button data-m="${esc(f)}">${esc(f)}</button>`).join('');
    box.innerHTML = `${items || `<p>${esc(t('editor.mediaNone'))}</p>`}
      <button data-m="@video">${esc(t('editor.mediaVideo'))}</button>
      <button data-m="@image">${esc(t('editor.mediaTemplate'))}</button>`;
  }
  function insertMedia(m) {
    $('.emedia').hidden = true;
    if (state.pickBg) { // 外觀設定面板的「選圖片」:設成背景圖
      state.pickBg = false;
      if (!m.startsWith('@')) setMeta('background', m);
      return;
    }
    const cap = t('editor.sampleCaption');
    const src = m === '@video' ? 'https://www.youtube.com/watch?v=' : m === '@image' ? 'media/photo.jpg' : m;
    const before = ta.value.slice(0, ta.selectionStart);
    const pad = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const text = `${pad}![${cap}](${src})\n`;
    // 範本就選取網址讓使用者直接改;實際檔案就選取說明文字
    const sel = m.startsWith('@') ? [pad.length + cap.length + 4, pad.length + cap.length + 4 + src.length] : [pad.length + 2, pad.length + 2 + cap.length];
    insert(text, sel);
    schedule();
  }

  async function setLayout(value) {
    const r = setSegmentMeta(ta.value, state.seg, 'layout', value === 'auto' ? '' : value);
    if (r.text === ta.value) return;
    const caret = ta.selectionStart;
    replaceRange(r.from, r.to, r.replaced, 'end');
    const delta = r.replaced.length - (r.to - r.from);
    const at = caret >= r.from ? caret + delta : caret;
    ta.setSelectionRange(Math.max(r.from, at), Math.max(r.from, at));
    preview();
  }

  el.addEventListener('click', e => {
    const k = e.target.closest('[data-e]')?.dataset.e;
    if (k === 'close') close();
    if (k === 'save') save();
    if (k === 'add') addSlide();
    if (k === 'archive') archive();
    if (k === 'prev') step(-1);
    if (k === 'next') step(1);
    if (k === 'revert') (async () => { if (!dirty() || (await confirmBox(t('editor.revertAsk'), t('editor.revert')))) { replaceRange(0, ta.value.length, state.original, 'end'); ta.setSelectionRange(0, 0); preview(); setStatus(t('editor.reverted')); } })();
    const tk = e.target.closest('button[data-t]')?.dataset.t;
    if (tk) tool(tk);
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m) insertMedia(m);
    // 面板內容可能已經重畫(按鈕不在畫面上了),所以用事件路徑判斷點的是不是面板裡面
    const inside = sel => e.composedPath().some(n => n.matches?.(sel));
    if (!inside('[data-t="media"], .emedia, [data-pickbg]')) { $('.emedia').hidden = true; state.pickBg = false; }
    if (!inside('[data-t="look"], .esettings, .emedia')) $('.esettings').hidden = true;
  });
  $('[data-t="layout"]').addEventListener('change', e => setLayout(e.target.value));
  ta.addEventListener('input', () => { schedule(); setStatus(dirty() ? t('editor.unsaved') : (canWrite ? t('editor.ready') : t('editor.readOnly')), dirty() ? 'warn' : ''); });
  ta.addEventListener('click', schedule);
  ta.addEventListener('keyup', e => { if (e.key.startsWith('Arrow') || e.key.startsWith('Page') || e.key === 'Home' || e.key === 'End') schedule(); });
  el.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); return save(); }
    if (e.altKey && (e.key === 'PageDown' || e.key === 'PageUp')) { e.preventDefault(); return step(e.key === 'PageDown' ? 1 : -1); }
    if (e.key === 'Escape' && e.target === ta) { e.preventDefault(); e.stopPropagation(); return close(); }
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab') { // Tab 縮排、Shift+Tab 反縮排;選了好幾行就一起
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b } = ta;
      const onList = /^\s*([-*+]|\d+\.)\s/.test(ta.value.slice(lineStart(a)));
      if (!e.shiftKey && a === b && !onList) return insert('  '); // 一般文字:插入空白
      const r = indentLines(ta.value, a, b, e.shiftKey);
      if (r.replaced === ta.value.slice(r.from, r.to)) return; // 沒有可以反縮排的
      const caretShift = r.replaced.split('\n')[0].length - ta.value.slice(r.from, ta.value.indexOf('\n', r.from) < 0 || ta.value.indexOf('\n', r.from) > r.to ? r.to : ta.value.indexOf('\n', r.from)).length;
      replaceRange(r.from, r.to, r.replaced, a === b ? [a - r.from + caretShift, a - r.from + caretShift] : 'all'); // 清單項目:整行縮排,游標留在原處
      schedule();
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { // 自動接續清單符號;空的項目按 Enter 就結束清單
      const before = ta.value.slice(0, ta.selectionStart);
      const s0 = before.lastIndexOf('\n') + 1;
      const line = before.slice(s0);
      const m = line.match(/^(\s*)([-*+]|\d+\.)\s+/);
      if (m && line.trim() === m[2]) { e.preventDefault(); replaceRange(s0, ta.selectionStart, ''); return; }
      if (m) {
        e.preventDefault();
        const next = /^\d+\./.test(m[2]) ? `${parseInt(m[2], 10) + 1}.` : m[2];
        insert(`\n${m[1]}${next} `);
        schedule();
      }
    }
  });
  window.addEventListener('beforeunload', e => { if (el.isConnected && dirty()) { e.preventDefault(); e.returnValue = ''; } });

  return { load, close, save, get dirty() { return dirty(); }, el };
}

const NOTE_LINE = /^\s*(?:note|notes|備註|講者備註)\s*[:：]/i; // 和 core/slide.js 的備註標記一致(i18n-ok:語法關鍵字)

/** 換掉檔案裡第 index 段(由單獨一行 --- 分隔)的 Note: 區塊。text 為空就移除備註。 */
export function replaceNotes(fileText, index, text) {
  const ranges = segmentRanges(fileText);
  const r = ranges[Math.min(index, ranges.length - 1)];
  const seg = fileText.slice(r.from, r.to);
  const lines = seg.split('\n');
  let at = -1, fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    else if (!fence && at < 0 && NOTE_LINE.test(l)) at = i;
  });
  const body = (at < 0 ? seg : lines.slice(0, at).join('\n')).replace(/\s+$/, '');
  const note = text.trim();
  const next = note ? `${body}\n\nNote:\n${note}\n` : `${body}\n`;
  return fileText.slice(0, r.from) + next + fileText.slice(r.to);
}
