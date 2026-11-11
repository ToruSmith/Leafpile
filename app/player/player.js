// 播放器:3D 舞台(各種排列)+ 單張放大 + 鍵盤操作 + 講者視窗同步 + 列印。

import { flatten } from '../core/library.js';
import { escapeHTML as esc, renderMarkdown } from '../core/markdown.js';
import { renderSlide, measureOverflow } from './render.js';
import { hydrate, playMedia, stopMedia } from './hydrate.js';
import { STAGES, STAGE_ORDER, CW, poseTransform, worldTransform } from './layouts.js';
import { THEMES, themeName, applyTheme, currentTheme } from './themes.js';
import { t } from '../core/i18n.js';
import { checkDeck } from '../core/check.js';
import { openCheckPanel } from '../ui/check-view.js';
import { Ink, PEN_COLORS, inkMarkup } from './ink.js';
import { zoomableImage, openLightbox } from './lightbox.js';
import { openReader } from './reader.js';
import { openEditor, replaceNotes } from './editor.js';

const EASE = 'cubic-bezier(.65, 0, .35, 1)';
const pad = n => String(n).padStart(2, '0');

// 快捷鍵說明(文字在 locales 的 key.*)
const ROTATE_KEY = 'leafpile-rotate-hint'; // 這次瀏覽只提示一次
const KEYS = [
  ['← →', 'key.prevNext'], ['↑ ↓', 'key.section'], ['Enter', 'key.enter'],
  ['Esc', 'key.esc'], ['1–9', 'key.jump'], ['G', 'key.goto'], ['Home End', 'key.homeEnd'],
  ['O', 'key.overview'], ['V', 'key.side'], ['D', 'key.ink'], ['X', 'key.clear'], ['M', 'key.read'], ['E', 'key.edit'], ['L', 'key.stage'], ['T', 'key.theme'], ['B', 'key.black'], ['F', 'key.full'],
  ['S', 'key.presenter'], ['P', 'key.print'], ['K', 'key.video'], ['R', 'key.reload'], ['?', 'key.help'],
];

// 動畫偏好:使用者在說明面板選的「完整 / 簡化」優先;沒選過就看系統的「減少動態」設定。
const MOTION_KEY = 'leafpile-motion';
function motionPreference() {
  try { const v = localStorage.getItem(MOTION_KEY); return v === 'full' || v === 'reduced' ? v : null; } catch { return null; }
}
function setMotion(v) { try { localStorage.setItem(MOTION_KEY, v); } catch { /* 隱私模式 */ } }
function motionReduced() {
  const pref = motionPreference();
  if (pref) return pref === 'reduced';
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class Player {
  constructor(root, { deck, source, start = 0, onExit, onIndex, theme, onReload, onExport, reading = false, qaKey = '' }) {
    this.qaKey = qaKey;
    this.onReload = onReload;
    this.reduced = motionReduced();
    this.root = root;
    this.deck = deck;
    this.source = source;
    this.onExit = onExit;
    this.onExport = onExport;
    this.onIndex = onIndex;
    this.slides = flatten(deck);
    this.sections = deck.sections;
    this.focus = Math.min(Math.max(0, start), this.slides.length - 1);
    this.cur = this.slides[this.focus]?.sec ?? 0;
    this.stage = STAGES[deck.stage] ? deck.stage : 'pile';
    // 手機:縮圖太小看不清楚,預設用「對照」(大圖 + 縮圖列);隨時可以換回牌堆
    if (window.matchMedia?.('(pointer: coarse) and (max-width: 600px), (pointer: coarse) and (max-height: 600px)').matches) this.stage = 'side';
    this.lastStage = this.stage === 'overview' ? 'pile' : this.stage;
    this.viewing = false;
    this.steps = [];
    this.stepIndex = 0;
    this.hydrated = new Set();
    this.channel = 'BroadcastChannel' in window ? new BroadcastChannel('leafpile-presenter') : null;
    this.startedAt = Date.now();
    // 畫筆:主畫面與講者視窗互相同步
    this.ink = new Ink({ onOp: op => this.presenterSeen && this.channel?.postMessage({ type: 'ink', op }), onChange: () => this.updateInkBar() });
    applyTheme(theme || deck.theme || 'paper');
    this.build();
    this.bind();
    this.intro();
    if (reading) this.openReading(); else this.rotateHint();
  }

  // ---------------- 建立畫面 ----------------
  build() {
    const d = this.deck;
    this.root.innerHTML = `
      <div class="player">
        <header class="pbar">
          ${this.onExit ? `<button class="pbtn back" data-act="exit" title="${esc(t('player.backTitle'))}">${esc(t('player.back'))}</button>` : ''}
          <div class="ptitle"><div class="deck-name">${esc(d.title)}</div><div class="sec-name"></div></div>
          <nav class="tabs"></nav>
          <div class="ptools">
            <select class="stage-select" title="${esc(t('player.stageTitle'))}" aria-label="${esc(t('player.stageTitle'))}">${Object.keys(STAGES).map(k => `<option value="${k}">${esc(t('stage.' + k))}</option>`).join('')}</select>
            <button class="pbtn" data-act="theme" title="${esc(t('player.themeTitle'))}">${esc(t('player.theme'))}</button>
            ${this.source.list && !d.flash ? `<button class="pbtn" data-act="check" title="${esc(t('player.checkTitle'))}">${esc(t('player.check'))}</button>` : ''}
            ${this.onExport ? `<button class="pbtn" data-act="export" title="${esc(t('player.exportTitle'))}">${esc(t('player.export'))}</button>` : ''}
            <button class="pbtn" data-act="read" title="${esc(t('player.readTitle'))}">${esc(t('player.read'))}</button>
            <button class="pbtn" data-act="ink" title="${esc(t('player.inkTitle'))}" aria-label="${esc(t('player.inkTitle'))}">✎</button>
            <button class="pbtn" data-act="present" title="${esc(t('player.presentTitle'))}" aria-label="${esc(t('player.presentTitle'))}">▶</button>
            <button class="pbtn" data-act="help" title="${esc(t('player.helpTitle'))}" aria-label="${esc(t('player.helpTitle'))}">?</button>
          </div>
        </header>
        <div class="stage"><div class="world"></div></div>
        <div class="viewer"><div class="frame"></div></div>
        <div class="ink-bar" role="toolbar" aria-label="${esc(t('ink.bar'))}">
          ${['laser', 'pen', 'highlight', 'eraser'].map(k => `<button data-ink="${k}" title="${esc(t('ink.' + k))}">${esc(t('ink.' + k))}</button>`).join('')}
          <button data-ink="color" class="ink-color" title="${esc(t('ink.color'))}" aria-label="${esc(t('ink.color'))}"><i></i></button>
          <span class="ink-sep"></span>
          <button data-ink="undo" title="${esc(t('ink.undoTitle'))}">${esc(t('ink.undo'))}</button>
          <button data-ink="clear" title="${esc(t('ink.clearTitle'))}">${esc(t('ink.clear'))}</button>
          <button data-ink="off" title="${esc(t('ink.offTitle'))}" aria-label="${esc(t('ink.offTitle'))}">✕</button>
        </div>
        <footer class="pfoot"><div class="progress"></div><div class="hint">${esc(t('player.hint'))}</div></footer>
        <div class="black"></div>
        <form class="jump" hidden><label>${esc(t('jump.label'))} <input type="number" min="1" inputmode="numeric" enterkeyhint="go"> <span class="jump-total"></span></label></form>
        <div class="help-panel"><div class="help-card"><h2>${esc(t('help.title'))}</h2><dl>${KEYS.map(([k, v]) => `<dt>${k.split(' ').map(x => `<kbd>${x}</kbd>`).join('')}</dt><dd>${esc(t(v))}</dd>`).join('')}</dl><p>${esc(t('help.foot'))}</p><div class="motion-row"><span>${esc(t('help.motion'))}</span><button data-motion="full">${esc(t('help.motionFull'))}</button><button data-motion="reduced">${esc(t('help.motionReduced'))}</button></div></div></div>
        <div class="sr-only" aria-live="polite"></div>
        <div class="issues"></div>
      </div>`;
    const $ = s => this.root.querySelector(s);
    this.el = { player: $('.player'), world: $('.world'), stage: $('.stage'), viewer: $('.viewer'), frame: $('.frame'), tabs: $('.tabs'), secName: $('.sec-name'), progress: $('.progress'), select: $('.stage-select'), black: $('.black'), jump: $('.jump'), help: $('.help-panel'), issues: $('.issues'), live: $('.sr-only') };

    this.buildCards();
    this.buildNav();
  }

  /** 建立所有卡片(重新載入時也會呼叫)。 */
  buildCards() {
    const d = this.deck;
    this.cards?.forEach(c => c.remove());
    this.cards = this.slides.map((s, gi) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = renderSlide(s, { deck: d, mode: 'thumb', globalIndex: gi, total: this.slides.length });
      card.addEventListener('click', e => { e.stopPropagation(); this.onCardClick(gi); });
      this.el.world.appendChild(card);
      return card;
    });
  }

  /** 章節標籤、進度條、提醒(重新載入時也會呼叫)。 */
  buildNav() {
    const d = this.deck;
    this.el.tabs.innerHTML = '';
    this.el.progress.innerHTML = '';
    this.el.tabs.style.display = '';
    this.sections.forEach((sec, si) => {
      const b = document.createElement('button');
      b.textContent = sec.folder ? pad(this.sections.filter(s => s.folder).indexOf(sec) + 1) : '●';
      b.title = sec.title || d.title;
      b.style.setProperty('--c', sec.color);
      b.onclick = () => this.setSection(si);
      this.el.tabs.appendChild(b);
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.style.flex = sec.slides.length;
      seg.style.setProperty('--c', sec.color);
      seg.innerHTML = '<i></i>';
      this.el.progress.appendChild(seg);
    });
    if (this.sections.length < 2) this.el.tabs.style.display = 'none';

    this.el.issues.innerHTML = '';
    if (d.issues?.length) {
      this.el.issues.innerHTML = `<details><summary>${esc(t('player.issues', { n: d.issues.length }))}</summary><ul>${d.issues.map(i => `<li><code>${esc(i.path)}</code>${esc(i.message)}</li>`).join('')}</ul></details>`;
    }
  }

  bind() {
    this.handlers = {
      key: e => this.onKey(e),
      resize: () => { this.layout('resize'); if (this.viewing) this.el.frame.style.transform = this.fit().t; }, // 手機轉向時放大的投影片也要重新置中
      touchStart: e => this.onTouchStart(e),
      touchEnd: e => this.onTouchEnd(e),
      wheel: e => this.onWheel(e),
      msg: e => this.onPresenterMessage(e.data),
    };
    window.addEventListener('keydown', this.handlers.key);
    window.addEventListener('resize', this.handlers.resize);
    this.el.stage.addEventListener('wheel', this.handlers.wheel, { passive: false });
    this.el.player.addEventListener('touchstart', this.handlers.touchStart, { passive: true });
    this.el.player.addEventListener('touchend', this.handlers.touchEnd, { passive: true });
    this.channel?.addEventListener('message', this.handlers.msg);
    this.root.querySelector('.pbar').addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'exit') this.exit();
      if (act === 'theme') this.cycleTheme();
      if (act === 'present') this.viewing ? this.closeViewer() : this.openViewer();
      if (act === 'read') this.openReading();
      if (act === 'ink') this.toggleInk();
      if (act === 'help') this.toggleHelp();
      if (act === 'check') this.openCheck();
      if (act === 'export') this.onExport?.(this);
    });
    this.el.select.value = this.stage;
    this.el.select.addEventListener('change', () => { this.setStage(this.el.select.value); this.el.select.blur(); });
    this.el.frame.addEventListener('click', e => {
      e.stopPropagation();
      if (this.ink.enabled || Date.now() - (this.swipedAt || 0) < 400) return;
      if (this.reclaim) { this.reclaim = false; return; } // 剛從嵌入網頁點回來:這一下只是拿回鍵盤,不翻頁
      const img = zoomableImage(e.target); // 點圖片 = 放大看完整的圖
      if (img) { this.closeLight = openLightbox(this.el.player, img, { onClose: () => { this.closeLight = null; } }); return; }
      if (!e.target.closest('video, audio, iframe, a, button')) this.next();
    });
    // 按下滑鼠的那一刻,鍵盤若還在嵌入的網頁 / 影片框框裡,這一下只是點回投影片(各瀏覽器都一致)
    this.el.frame.addEventListener('pointerdown', () => { this.reclaim = document.activeElement?.tagName === 'IFRAME'; }, true);
    this.root.querySelector('.ink-bar').addEventListener('click', e => {
      e.stopPropagation();
      const k = e.target.closest('[data-ink]')?.dataset.ink;
      if (!k) return;
      if (k === 'off') return this.toggleInk(false);
      if (k === 'undo') return this.ink.undo();
      if (k === 'clear') return this.ink.clear();
      if (k === 'color') { this.ink.color = PEN_COLORS[(PEN_COLORS.indexOf(this.ink.color) + 1) % PEN_COLORS.length]; if (this.ink.tool !== 'pen') this.ink.setTool('pen'); else this.updateInkBar(); return; }
      this.ink.setTool(k);
    });
    this.el.viewer.addEventListener('click', () => this.closeViewer());
    this.el.help.addEventListener('click', e => {
      const m = e.target.closest('[data-motion]')?.dataset.motion;
      if (m) { setMotion(m); this.reduced = motionReduced(); this.updateMotionButtons(); return; }
      if (!e.target.closest('.help-card')) this.toggleHelp(false);
    });
    this.updateMotionButtons();
    this.el.black.addEventListener('click', () => this.el.black.classList.remove('on'));
  }

  // ---------------- 手機直放提示 ----------------
  // 投影片是 16:9,手機直放時很小:提示轉成橫向。Android 可一鍵全螢幕並鎖定橫向;iPhone 只能提示。
  rotateHint() {
    const portrait = window.matchMedia?.('(orientation: portrait) and (pointer: coarse) and (max-width: 600px)');
    if (!portrait?.matches) return;
    try { if (sessionStorage.getItem(ROTATE_KEY)) return; } catch { /* 隱私模式 */ }
    const canLock = !!(document.fullscreenEnabled && screen.orientation?.lock);
    const box = document.createElement('div');
    box.className = 'rotate-hint';
    box.innerHTML = `<div class="rotate-card"><div class="rotate-phone" aria-hidden="true"></div><p>${esc(t('player.rotate'))}</p><div class="rotate-actions">${canLock ? `<button class="btn primary" data-r="lock">${esc(t('player.rotateLock'))}</button>` : ''}<button class="btn ghost" data-r="ok">${esc(t('player.rotateOk'))}</button></div></div>`;
    this.el.player.append(box);
    const close = () => {
      box.remove();
      portrait.removeEventListener?.('change', onChange);
      try { sessionStorage.setItem(ROTATE_KEY, '1'); } catch { /* 隱私模式 */ }
    };
    const onChange = e => { if (!e.matches) close(); }; // 轉成橫向就自動關掉
    portrait.addEventListener?.('change', onChange);
    this.closeRotateHint = close;
    box.addEventListener('click', async e => {
      const act = e.target.closest('[data-r]')?.dataset.r;
      if (act === 'lock') {
        try { await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); } catch { /* 不支援就算了 */ }
      }
      if (act) close();
    });
  }

  destroy() {
    this.reader?.close();
    this.closeLight?.();
    if (this.el?.player?.querySelector('.rotate-hint')) this.closeRotateHint?.();
    window.removeEventListener('keydown', this.handlers.key);
    window.removeEventListener('resize', this.handlers.resize);
    this.channel?.removeEventListener('message', this.handlers.msg);
    this.channel?.close();
    stopMedia(this.root);
    this.source.releaseMedia?.();
    this.root.innerHTML = '';
  }

  exit() { this.onExit?.(); }

  // ---------------- 版面與動畫 ----------------
  computeLayout() {
    this.el.player.dataset.stage = this.stage; // 讓樣式知道目前的排列(對照模式要隱藏放大後的外框)
    const { innerWidth: vw, innerHeight: vh } = window;
    return STAGES[this.stage].fn({ slides: this.slides, sections: this.sections, cur: this.cur, focus: this.focus, vw, vh });
  }

  layout(kind = 'focus') {
    const { poses, world } = this.computeLayout();
    this.el.world.style.transition = kind === 'resize' ? 'none' : `transform ${this.reduced ? 0.35 : kind === 'focus' ? 0.6 : 1.1}s ${EASE}`;
    this.el.world.style.transform = worldTransform(world);
    let leave = 0, enter = 0;
    poses.forEach((to, gi) => {
      const el = this.cards[gi];
      const from = el._pose;
      const cs = getComputedStyle(el);
      const fromT = cs.transform === 'none' ? poseTransform(from || to) : cs.transform;
      const fromO = cs.opacity;
      el.getAnimations().forEach(a => a.cancel());
      let frames, delay = 0, dur = 450;
      const crossing = kind === 'shuffle' && from && (from.d === 0) !== (to.d === 0);
      if (kind === 'resize') frames = null;
      else if (this.reduced && kind !== 'focus' && from) {
        // 簡化動畫(系統設定減少動態,或使用者選「簡化」):原地淡出、在新位置淡入,沒有隨機飛行
        frames = [{ transform: fromT, opacity: fromO }, { transform: fromT, opacity: 0, offset: 0.4 },
          { transform: `${poseTransform(to)} translateY(12px)`, opacity: 0, offset: 0.6 }, { transform: poseTransform(to), opacity: to.o }];
        dur = 420;
      }
      else if (crossing) {
        const leaving = from.d === 0;
        const mid = { x: (from.x + to.x) / 2 + (Math.random() - 0.5) * 260, y: (from.y + to.y) / 2 + (leaving ? -300 : 260),
          z: Math.max(from.z, to.z) + (leaving ? 80 : 220), rx: leaving ? 35 : -25, ry: (Math.random() - 0.5) * 50, rz: (Math.random() - 0.5) * 36, s: 1 };
        frames = [{ transform: fromT, opacity: fromO }, { transform: poseTransform(mid), opacity: leaving ? 0.75 : 0.95, offset: 0.5 }, { transform: poseTransform(to), opacity: to.o }];
        dur = 1150;
        delay = leaving ? leave++ * 45 : 330 + enter++ * 60;
      } else {
        frames = [{ transform: fromT, opacity: fromO }, { transform: poseTransform(to), opacity: to.o }];
        if (kind === 'shuffle') { dur = 1000; delay = 200 + Math.random() * 200; }
        if (kind === 'stage') { dur = 1100; delay = Math.random() * 280; }
        if (kind === 'intro') { dur = 1300; delay = 150 + Math.min(gi, 40) * 28; }
      }
      el.style.transform = poseTransform(to);
      el.style.opacity = to.o;
      el.style.pointerEvents = to.o < 0.2 ? 'none' : '';
      el.style.visibility = to.o === 0 && !frames ? 'hidden' : '';
      if (frames) el.animate(frames, { duration: dur, delay, easing: EASE, fill: 'backwards' });
      el._pose = to;
      el.classList.toggle('focus', gi === this.focus && !this.viewing);
      // 目前的卡片可用鍵盤聚焦,Enter 由全域按鍵處理放大
      if (gi === this.focus) { el.setAttribute('role', 'button'); el.tabIndex = 0; el.setAttribute('aria-label', t('player.slideLabel', { n: gi + 1, title: this.slides[gi].title || '' })); }
      else { el.removeAttribute('role'); el.removeAttribute('tabindex'); el.removeAttribute('aria-label'); }
    });
    if (this.announced !== this.focus) {
      this.announced = this.focus;
      this.el.live.textContent = t('player.slideLabel', { n: this.focus + 1, title: this.slides[this.focus]?.title || '' });
    }
    this.updateChrome();
    this.hydrateNearby();
    this.syncThumbVideo();
    this.onIndex?.(this.focus);
    this.broadcast();
  }

  intro() {
    this.cards.forEach((el, i) => {
      el._pose = { x: 0, y: 40, z: -900 + i * 3, rx: 0, ry: 0, rz: (Math.random() - 0.5) * 20, s: 1, o: 0, d: 9 };
      el.style.transform = poseTransform(el._pose);
      el.style.opacity = 0;
    });
    requestAnimationFrame(() => this.layout('intro'));
  }

  hydrateNearby() {
    this.slides.forEach((s, gi) => {
      if (this.hydrated.has(gi)) return;
      const near = Math.abs(gi - this.focus) <= 10 || Math.abs(s.sec - this.cur) <= 1;
      const visible = (this.cards[gi]._pose?.o ?? 0) > 0;
      if (near && visible) { this.hydrated.add(gi); hydrate(this.cards[gi], this.source); }
    });
  }

  syncThumbVideo() {
    this.cards.forEach((c, gi) => c.querySelectorAll('video').forEach(v => {
      if (gi === this.focus && !this.viewing) v.play()?.catch(() => {}); else v.pause();
    }));
  }

  updateChrome() {
    const sec = this.sections[this.cur];
    this.el.secName.textContent = sec?.title || '';
    this.el.player.style.setProperty('--c', sec?.color || '');
    [...this.el.tabs.children].forEach((b, i) => b.classList.toggle('on', i === this.cur));
    const s = this.slides[this.focus];
    [...this.el.progress.children].forEach((seg, i) => {
      seg.firstChild.style.transform = `scaleX(${i < this.cur ? 1 : i > this.cur ? 0 : (s.i + 1) / this.sections[i].slides.length})`;
    });
    this.el.select.value = this.stage;
  }

  // ---------------- 導覽 ----------------
  goTo(gi, { fromViewer = false } = {}) {
    gi = Math.max(0, Math.min(this.slides.length - 1, gi));
    if (gi === this.focus && !fromViewer) return;
    const prevSec = this.cur, dir = Math.sign(gi - this.focus) || 1;
    this.focus = gi;
    this.cur = this.slides[gi].sec;
    if (this.stage === 'overview' && !this.viewing) this.stage = 'overview';
    this.layout(this.cur !== prevSec && STAGES[this.stage].shuffle ? 'shuffle' : 'focus');
    if (this.viewing) this.showInViewer(dir);
  }

  next() {
    if (this.viewing && this.stepIndex < this.steps.length) { this.steps[this.stepIndex++].classList.remove('hidden'); this.broadcast(); return; }
    this.goTo(this.focus + 1);
  }

  prev() {
    if (this.viewing && this.stepIndex > 0) { this.steps[--this.stepIndex].classList.add('hidden'); this.broadcast(); return; }
    const target = this.focus - 1;
    this.goTo(target);
    if (this.viewing && this.steps.length) { this.steps.forEach(s => s.classList.remove('hidden')); this.stepIndex = this.steps.length; }
  }

  setSection(si) {
    si = (si + this.sections.length) % this.sections.length;
    const gi = this.slides.findIndex(s => s.sec === si);
    if (this.stage === 'overview') this.stage = this.lastStage;
    if (gi >= 0) this.goTo(gi);
  }

  setStage(name) {
    if (!STAGES[name]) return;
    if (name !== 'overview') this.lastStage = name;
    this.stage = name;
    if (this.viewing) this.closeViewer();
    this.layout('stage');
  }

  cycleStage() {
    const i = STAGE_ORDER.indexOf(this.stage);
    this.setStage(STAGE_ORDER[(i + 1) % STAGE_ORDER.length]);
  }

  toggleOverview() { this.setStage(this.stage === 'overview' ? this.lastStage : 'overview'); }

  /** 對照模式(V):大圖 + 縮圖列;再按一次回到原本的排列。 */
  toggleSide() {
    if (this.stage === 'side') return this.setStage(this.prevStage && this.prevStage !== 'side' ? this.prevStage : 'pile');
    this.prevStage = this.stage;
    this.setStage('side');
  }

  cycleTheme() {
    const i = THEMES.indexOf(currentTheme());
    applyTheme(THEMES[(i + 1) % THEMES.length]);
    this.toast(t('toast.theme', { name: themeName(currentTheme()) }));
  }

  onCardClick(gi) {
    if (this.stage === 'overview') { this.stage = this.lastStage; this.focus = gi; this.cur = this.slides[gi].sec; this.layout('stage'); return; }
    if (gi === this.focus) return this.openViewer();
    const prevSec = this.cur;
    this.focus = gi;
    this.cur = this.slides[gi].sec;
    this.layout(this.cur !== prevSec && STAGES[this.stage].shuffle ? 'shuffle' : 'focus');
  }

  onWheel(e) {
    e.preventDefault();
    const now = Date.now();
    if (now - (this.lastWheel || 0) < 160) return;
    this.lastWheel = now;
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 4) return;
    d > 0 ? this.goTo(this.focus + 1) : this.goTo(this.focus - 1);
  }

  onKey(e) {
    if (e.target.closest?.('input, textarea, select')) return;
    const k = e.key;
    if (this.ink.enabled && (e.metaKey || e.ctrlKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); this.ink.undo(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.handleKey(k)) e.preventDefault();
  }

  /** 一個按鍵該做什麼。主畫面的鍵盤和講者視窗送來的按鍵都走這裡,行為才會一致。
   *  remote = 來自講者視窗。回傳 true 表示已處理。 */
  handleKey(k, { remote = false } = {}) {
    if (this.editor) { // 編輯模式:文字框自己處理按鍵,只有 Esc 在任何地方都能關閉
      if (k === 'Escape') { this.editor.close(); return true; }
      return false;
    }
    if (this.el.black.classList.contains('on')) { this.el.black.classList.remove('on'); return true; } // 黑屏時按任何鍵(含 B)回來
    if (this.el.help.classList.contains('on') && k !== '?') { this.toggleHelp(false); if (k === 'Escape') return true; }
    if (this.reader) {
      if (remote && k === ' ') k = 'PageDown'; // 講者視窗沒辦法捲動閱讀頁:空白鍵當成下一張
      return this.readerKey(k);
    }
    if (this.closeLight) { this.closeLight(); return true; }
    if (remote && (k === 'g' || k === 'G')) return false; // 輸入框會出現在投影畫面上,講者視窗不轉送
    return this.command(k);
  }

  command(k) {
    switch (k) {
      case 'ArrowRight': case 'PageDown': case 'n': case 'N': this.next(); break;
      case 'ArrowLeft': case 'PageUp': this.prev(); break;
      case ' ': this.viewing ? this.next() : this.openViewer(); break;
      case 'ArrowDown': this.setSection(this.cur + 1); break;
      case 'ArrowUp': this.setSection(this.cur - 1); break;
      case 'Home': this.goTo(0); break;
      case 'End': this.goTo(this.slides.length - 1); break;
      case 'Enter': this.viewing ? this.closeViewer() : this.openViewer(); break;
      case 'Escape':
        if (this.ink.enabled) this.toggleInk(false);
        else if (this.viewing) this.closeViewer();
        else if (this.stage === 'overview') this.toggleOverview();
        else if (document.fullscreenElement) document.exitFullscreen();
        else this.exit();
        break;
      case 'o': case 'O': this.toggleOverview(); break;
      case 'v': case 'V': this.toggleSide(); break;
      case 'd': case 'D': this.toggleInk(); break;
      case 'x': case 'X': if (!this.ink.enabled) return false; this.ink.clear(); break;
      case 'm': case 'M': this.openReading(); break;
      case 'e': case 'E': this.openEditing(); break;
      case 'g': case 'G': this.openJump(); break;
      case 'l': case 'L': this.cycleStage(); break;
      case 't': case 'T': this.cycleTheme(); break;
      case 'b': case 'B': case '.': this.el.black.classList.add('on'); break;
      case 'f': case 'F': document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); break;
      case 's': case 'S': this.openPresenter(); break;
      case 'p': case 'P': this.print(); break;
      case 'k': case 'K': this.toggleMedia(); break;
      case 'r': case 'R': this.reload(); break;
      case '?': case '/': this.toggleHelp(); break;
      default:
        if (/^[1-9]$/.test(k)) { const numbered = this.sections.map((s, i) => [s, i]).filter(([s]) => s.folder); const hit = numbered[+k - 1]; if (hit) this.setSection(hit[1]); break; }
        return false;
    }
    return true;
  }

  openCheck() {
    const d = this.deck;
    openCheckPanel(this.el.player, async () => {
      const r = await checkDeck(this.source, d);
      r.problems.push(...await this.overflowProblems());
      return { kind: 'deck', title: d.title, topics: [{ title: '', decks: [r] }], problems: r.problems };
    });
  }

  /** 逐張在看不見的地方算繪,找出內容超出投影片的張數(檢查工具在命令列量不到,只有瀏覽器做得到)。 */
  async overflowProblems() {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:720px;visibility:hidden;pointer-events:none';
    document.body.append(box);
    const out = [];
    try {
      await document.fonts?.ready;
      for (const [i, sl] of this.slides.entries()) {
        box.innerHTML = renderSlide(sl, { deck: this.deck, mode: 'full', globalIndex: i, total: this.slides.length });
        const over = measureOverflow(box.firstElementChild);
        if (over) out.push({ path: sl.file || this.deck.path, message: t(/^(small|compact)$/i.test(String(sl.style?.size || this.deck.size || '')) ? 'check.overflowCompact' : 'check.overflow', { n: i + 1, px: over }) });
      }
    } finally { box.remove(); }
    return out;
  }

  async reload() {
    if (!this.onReload) return this.toast(t('player.reloadUnsupported'));
    const deck = await this.onReload();
    if (deck) { this.replaceDeck(deck); this.toast(t('player.reloaded')); }
  }

  /** 換上新讀到的簡報:保留目前張數與是否放大,不重播開場動畫。 */
  replaceDeck(deck) {
    const wasViewing = this.viewing;
    const sameShape = deck.sections.length === this.sections.length && deck.sections.every((s, i) => s.slides.length === this.sections[i].slides.length);
    this.deck = deck;
    this.slides = flatten(deck);
    this.sections = deck.sections;
    this.focus = Math.min(this.focus, this.slides.length - 1);
    this.cur = this.slides[this.focus]?.sec ?? 0;
    this.hydrated.clear();
    if (sameShape) {
      // 結構沒變:只換卡片內容
      this.cards.forEach((c, gi) => { c.innerHTML = renderSlide(this.slides[gi], { deck, mode: 'thumb', globalIndex: gi, total: this.slides.length }); });
    } else {
      // 章節或張數變了:重建卡片,新卡片從目前的位置開始移動
      const old = this.cards.map(c => c._pose);
      this.buildCards();
      this.cards.forEach((c, gi) => { c._pose = old[Math.min(gi, old.length - 1)]; c.style.transform = poseTransform(c._pose); });
    }
    this.buildNav();
    this.layout('focus');
    if (wasViewing) { this.hideCard(this.cards[this.focus]); this.fillFrame(); }
  }

  updateMotionButtons() {
    const pref = motionPreference();
    this.el.help.querySelectorAll('[data-motion]').forEach(b => {
      const on = b.dataset.motion === (pref || (this.reduced ? 'reduced' : 'full'));
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  toggleHelp(force) { this.el.help.classList.toggle('on', force); }

  toast(msg) {
    let el = this.root.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; this.el.player.appendChild(el); }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('on'), 1600);
  }

  // ---------------- 觸控(手機、平板) ----------------
  // 左右滑 = 上一張 / 下一張;沒放大時上下滑 = 換章節。點一下仍然是原本的點擊。
  onTouchStart(e) {
    if (e.touches.length !== 1 || e.target.closest('.pbar, .help-panel, .issues, .ink-bar, .ink.on, .lightbox, .reader, video, audio, iframe, select')) { this.touch = null; return; }
    const p = e.touches[0];
    this.touch = { x: p.clientX, y: p.clientY, at: Date.now() };
  }

  onTouchEnd(e) {
    const s = this.touch;
    this.touch = null;
    if (!s || e.changedTouches.length !== 1 || Date.now() - s.at > 800) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - s.x, dy = p.clientY - s.y;
    const min = Math.max(40, Math.min(window.innerWidth, window.innerHeight) * 0.08);
    if (Math.abs(dx) >= min && Math.abs(dx) > Math.abs(dy) * 1.3) {
      this.swipedAt = Date.now();
      dx < 0 ? this.next() : this.prev();
    } else if (!this.viewing && Math.abs(dy) >= min && Math.abs(dy) > Math.abs(dx) * 1.3) {
      this.swipedAt = Date.now();
      this.setSection(this.cur + (dy < 0 ? 1 : -1));
    }
  }

  // ---------------- 放大檢視 ----------------
  fit() {
    const pad = window.innerHeight < 500 ? 24 : 96; // 手機橫放時高度很小,少留一點邊
    const bar = this.ink?.enabled ? 64 : 0; // 畫筆工具列:投影片縮小一點、往上移,工具列放在下面空出來的位置
    const sc = Math.min(window.innerWidth * 0.92 / 1280, (window.innerHeight - pad - bar) / 720);
    return { sc, t: `translate(${(window.innerWidth - 1280 * sc) / 2}px, ${(window.innerHeight - bar - 720 * sc) / 2 - 6}px) scale(${sc})` };
  }

  renderFull(gi) {
    return renderSlide(this.slides[gi], { deck: this.deck, mode: 'full', globalIndex: gi, total: this.slides.length });
  }

  openViewer() {
    if (this.stage === 'overview') { this.stage = this.lastStage; this.layout('stage'); }
    const card = this.cards[this.focus];
    const r = card.getBoundingClientRect();
    this.viewing = true;
    this.fillFrame();
    const f = this.fit();
    this.el.frame.style.transform = f.t;
    this.el.frame.style.opacity = 1;
    this.el.frame.animate([{ transform: `translate(${r.left}px, ${r.top}px) scale(${r.width / 1280})` }, { transform: f.t }], { duration: 560, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    this.el.viewer.classList.add('on');
    this.el.player.classList.add('viewing');
    this.hideCard(card);
    card.classList.remove('focus');
    this.syncThumbVideo();
    this.broadcast();
  }

  closeViewer() {
    if (!this.viewing) return;
    this.viewing = false;
    stopMedia(this.el.frame);
    const card = this.cards[this.focus];
    const r = card.getBoundingClientRect();
    this.el.viewer.classList.remove('on');
    this.el.player.classList.remove('viewing');
    if (this.ink.enabled) this.toggleInk(false);
    const a = this.el.frame.animate([{ transform: this.fit().t }, { transform: `translate(${r.left}px, ${r.top}px) scale(${r.width / 1280})` }], { duration: 440, easing: 'cubic-bezier(.4, 0, .2, 1)' });
    this.el.frame.style.opacity = 0;
    a.onfinish = () => { this.showCard(); card.classList.add('focus'); this.el.frame.innerHTML = ''; this.syncThumbVideo(); };
    this.broadcast();
  }

  hideCard(card) { this.showCard(); this.hiddenCard = card; card.style.visibility = 'hidden'; }
  showCard() { if (this.hiddenCard) this.hiddenCard.style.visibility = ''; this.hiddenCard = null; }

  fillFrame() {
    stopMedia(this.el.frame);
    this.el.frame.innerHTML = this.renderFull(this.focus);
    const slide = this.slides[this.focus];
    this.steps = [];
    this.stepIndex = 0;
    if (slide.meta?.step) {
      this.steps = [...this.el.frame.querySelectorAll('.md > ul > li, .md > ol > li, .stat, .tl-item, .col, .ag')];
      this.steps.forEach(s => s.classList.add('step', 'hidden'));
    }
    this.ink.mount(this.el.frame, this.focus);
    hydrate(this.el.frame, this.source, { full: true }).then(() => { if (this.viewing) playMedia(this.el.frame, { sound: true }); });
  }

  /** K:放大的投影片上的本機影片 / 音訊播放或暫停,並顯示結果(沒有影片時也說明)。 */
  toggleMedia() {
    const media = this.viewing ? [...this.el.frame.querySelectorAll('video, audio')] : [];
    if (!media.length) {
      const embed = this.viewing && this.el.frame.querySelector('iframe, [data-embed]');
      return this.toast(t(embed ? 'toast.kEmbed' : this.viewing ? 'toast.kNone' : 'toast.kZoom'));
    }
    const play = media.every(v => v.paused);
    media.forEach(v => (play ? v.play().catch(() => {}) : v.pause()));
    this.toast(t(play ? 'toast.kPlay' : 'toast.kPause'));
  }

  // ---------------- 畫筆與雷射筆(D) ----------------
  toggleInk(on = !this.ink.enabled) {
    if (on && !this.viewing) this.openViewer();
    const before = this.el.frame.style.transform;
    this.ink.setEnabled(on);
    this.el.player.classList.toggle('inking', on);
    if (this.viewing) {
      const to = this.fit().t;
      this.el.frame.style.transform = to;
      if (before && before !== to) this.el.frame.animate([{ transform: before }, { transform: to }], { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    }
  }

  updateInkBar() {
    const bar = this.root.querySelector('.ink-bar');
    if (!bar) return;
    bar.querySelectorAll('[data-ink]').forEach(b => b.classList.toggle('on', b.dataset.ink === this.ink.tool));
    bar.querySelector('.ink-color i').style.background = this.ink.color;
    bar.querySelector('[data-ink="undo"]').disabled = !this.ink.history.get(this.focus)?.length;
    this.root.querySelector('[data-act="ink"]')?.classList.toggle('on', this.ink.enabled);
  }

  // ---------------- 閱讀模式(M) ----------------
  openReading() {
    if (this.reader) return;
    if (this.viewing) this.closeViewer();
    if (this.ink.enabled) this.toggleInk(false);
    if (this.el.player.querySelector('.rotate-hint')) this.closeRotateHint?.();
    this.el.player.classList.add('reading');
    this.reader = openReader(this, this.focus, {
      onIndex: gi => {
        this.onIndex?.(gi, true);
        this.focus = gi; // 講者視窗跟著顯示正在讀的那一張
        this.cur = this.slides[gi].sec;
        this.broadcast();
      },
      onPrint: () => this.print({ handout: true }),
      onClose: gi => {
        this.reader = null;
        this.el.player.classList.remove('reading');
        this.goTo(gi);
        this.onIndex?.(gi, false);
      },
    });
  }

  closeReading() { this.reader?.close(); }

  /** 講者視窗送來的備註:換掉那個檔案裡對應那一段的 Note: 區塊,再寫回去。 */
  async saveNotes(gi, text) {
    const slide = this.slides[gi];
    const reply = ok => this.channel?.postMessage({ type: 'notesResult', ok });
    if (!slide || !this.source.canWrite || this.deck.flash) return reply(false); // 快閃播放:不寫回筆記
    try {
      const before = await this.source.readText(slide.file);
      const next = replaceNotes(before, slide.index ?? 0, text);
      await this.source.writeText(slide.file, next, { expect: await this.source.stat(slide.file) });
      reply(true);
      if (this.onReload) await this.reload();
    } catch {
      reply(false);
    }
  }

  // ---------------- 跳到第幾張(G) ----------------
  /** 輸入頁碼跳過去(問答時找某一張數據很好用)。數字鍵 1–9 仍是跳章節。 */
  openJump() {
    const form = this.el.jump, input = form.querySelector('input');
    form.querySelector('.jump-total').textContent = t('jump.total', { total: this.slides.length });
    input.max = this.slides.length;
    input.value = '';
    form.hidden = false;
    input.focus();
    const done = () => { form.hidden = true; form.onsubmit = input.onkeydown = input.onblur = null; this.el.player.focus?.(); };
    form.onsubmit = e => {
      e.preventDefault();
      const n = parseInt(input.value, 10);
      done();
      if (n >= 1) this.goTo(Math.min(n, this.slides.length) - 1);
    };
    input.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } };
    input.onblur = () => setTimeout(() => { if (!form.hidden) done(); }, 0);
  }

  // ---------------- 編輯模式(E) ----------------
  /** 第 gi 張投影片要編輯哪個檔案、檔案裡的第幾段。
   *  自動產生的封面與章節頁沒有自己的 MD 檔,改成編輯 deck.yml(標題就寫在那裡)。 */
  editTarget(gi) {
    const slide = this.slides[gi];
    if (!slide) return null;
    const auto = !(slide.index >= 0) || !/\.md$/i.test(slide.file || '');
    return { path: auto ? `${this.deck.path}/deck.yml` : slide.file, segment: auto ? 0 : slide.index, auto };
  }

  async openEditing() {
    if (this.editor || !this.source.readText || this.deck.flash) return; // 快閃播放是暫時的投影片,要改請回筆記
    const target = this.editTarget(this.focus);
    if (!target) return;
    const { path, auto } = target;
    this.reader?.close();
    if (this.ink.enabled) this.toggleInk(false);
    this.closeLight?.();
    this.el.player.classList.add('editing');
    this.editor = openEditor(this, {
      onSaved: () => this.onReload && this.reload().then(d => d && this.replaceDeck(d)),
      onClose: () => { this.editor = null; this.el.player.classList.remove('editing'); },
    });
    if (!(await this.editor.load(path, { segment: target.segment, note: auto ? t('editor.autoSlide') : '' }))) this.editor.close();
  }

  /** 閱讀模式的按鍵:捲動類交給閱讀模式;黑屏、全螢幕、主題、講者視窗等照常;
   *  放大、畫筆、換排列、跳章節則先回到投影片再執行。回傳 true 表示已處理。 */
  readerKey(k) {
    if (this.reader.key(k)) return true;
    if (['b', 'B', '.', 'f', 'F', 't', 'T', 's', 'S', 'k', 'K', '?'].includes(k)) return this.command(k);
    if (['Enter', 'd', 'D', 'v', 'V', 'o', 'O', 'l', 'L', 'g', 'G'].includes(k) || /^[1-9]$/.test(k)) {
      this.reader.close();
      return this.command(k);
    }
    return false;
  }

  showInViewer(dir) {
    this.hideCard(this.cards[this.focus]);
    this.fillFrame();
    this.el.frame.firstElementChild?.animate([{ transform: `translateX(${dir * 70}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  }

  // ---------------- 講者視窗 ----------------
  openPresenter() {
    if (!this.channel) return this.toast(t('toast.noPresenter'));
    const w = window.open(`${location.pathname}#/presenter`, 'leafpile-presenter', 'width=1200,height=760');
    if (!w) this.toast(t('toast.popupBlocked'));
    this.startedAt = Date.now();
  }

  onPresenterMessage(m) {
    if (!m) return;
    if (m.type === 'hello') { this.presenterSeen = true; this.broadcast(); }
    if (m.type === 'key') this.handleKey(m.key, { remote: true });
    if (m.type === 'ink' && m.op) this.ink.apply(m.op);
    if (m.type === 'notes') this.saveNotes(m.gi, m.text);
  }

  async broadcast() {
    if (!this.channel || !this.presenterSeen) return; // 沒開講者視窗就不做事
    const gi = this.focus;
    const cur = this.renderFull(gi);
    const next = gi + 1 < this.slides.length ? this.renderFull(gi + 1) : '';
    const paths = [...(cur + next).matchAll(/data-(?:media|bg)="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
    const media = {};
    await Promise.all(paths.map(p => (/^(https?:|data:)/.test(p) ? Promise.resolve(p) : this.source.mediaURL(p)).then(u => { media[p] = u; }, () => {})));
    const s = this.slides[gi];
    this.channel.postMessage({
      type: 'state', title: this.deck.title, section: this.sections[s.sec]?.title || '',
      n: gi + 1, total: this.slides.length, cur, next, media, theme: currentTheme(),
      ink: this.ink.get(gi), gi, canEdit: !!this.source.canWrite && !this.deck.flash,
      qaKey: this.deck.flash ? '' : this.qaKey || '',
      notes: s.notes ? renderMarkdown(s.notes) : '', notesText: s.notes || '', steps: this.steps.length, step: this.stepIndex, viewing: this.viewing, startedAt: this.startedAt,
    });
  }

  // ---------------- 列印 / PDF ----------------
  /** handout = 講義:每張投影片縮小,下面附講者備註(A4 直式)。畫筆畫的內容一併印出。 */
  async print({ handout = false } = {}) {
    this.toast(t('toast.printing'));
    const box = document.createElement('div');
    box.id = 'print-root';
    let pageStyle = null;
    if (handout) {
      // 講義用 A4 直式(暫時蓋過投影片用的 1280×720 頁面,印完拿掉)
      pageStyle = document.createElement('style');
      pageStyle.textContent = '@page { size: A4 portrait; margin: 14mm; }';
      document.head.append(pageStyle);
      box.className = 'handout';
      box.innerHTML = `<h1 class="handout-title">${esc(this.deck.title)}</h1>` + this.slides.map((s, gi) => `<section class="handout-item"><div class="handout-slide"><div class="handout-scale">${this.renderFull(gi)}${inkMarkup(this.ink.get(gi))}</div></div>${s.notes ? `<div class="handout-notes">${renderMarkdown(s.notes)}</div>` : ''}</section>`).join('');
    } else {
      box.innerHTML = this.slides.map((_, gi) => `<div class="print-page">${this.renderFull(gi)}${inkMarkup(this.ink.get(gi))}</div>`).join('');
    }
    document.body.appendChild(box);
    await hydrate(box, this.source);
    await Promise.all([...box.querySelectorAll('img')].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    document.documentElement.classList.add('printing');
    const done = () => { document.documentElement.classList.remove('printing'); box.remove(); pageStyle?.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(() => { if (document.getElementById('print-root')) done(); }, 60000);
  }
}

export { CW };
