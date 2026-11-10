// 畫筆與雷射筆:蓋在放大的投影片上的一層 SVG。
//
// - 座標一律用投影片本身的 1280×720,所以放大畫面、講者視窗、列印都對得準。
// - 雷射筆(預設):畫的線會累積,停筆約 1.2 秒後一起淡出(參考 tldraw 重新設計後的雷射筆)。
// - 畫筆:依移動速度改變粗細(畫快變細、畫慢變粗);觸控筆有壓力時用真實壓力。
// - 螢光筆、橡皮擦、復原、清除。每張投影片的畫各自保留到這次播放結束。
// - 兩個視窗(主畫面與講者視窗)透過 onOp / apply 互相同步。

const NS = 'http://www.w3.org/2000/svg';
const W = 1280, H = 720;
export const PEN_COLORS = ['#d6453d', '#2f6fd6', '#1f2328'];
const LASER_IDLE = 1200, LASER_FADE = 500;

const round = n => Math.round(n * 10) / 10;
const mid = (a, b) => `${round((a[0] + b[0]) / 2)},${round((a[1] + b[1]) / 2)}`;

/** 畫筆:沿著筆跡兩側依粗細展開成一個封閉的平滑外框。 */
function penPath(pts, size) {
  if (pts.length < 2) {
    const [x, y, p = 0.6] = pts[0] || [0, 0];
    const r = round(size * (0.35 + 0.65 * p) / 2);
    return `M${x - r},${y}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0Z`;
  }
  const left = [], right = [];
  pts.forEach(([x, y, p], i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const w = size * (0.35 + 0.65 * p) / 2;
    left.push([x - dy / len * w, y + dx / len * w]);
    right.push([x + dy / len * w, y - dx / len * w]);
  });
  const ring = [...left, ...right.reverse()];
  let d = `M${mid(ring[0], ring[1])}`;
  for (let i = 1; i <= ring.length; i++) {
    const a = ring[i % ring.length], b = ring[(i + 1) % ring.length];
    d += `Q${round(a[0])},${round(a[1])} ${mid(a, b)}`;
  }
  return d + 'Z';
}

/** 螢光筆與雷射筆:一般的折線。 */
const linePath = pts => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)},${round(y)}`).join('');

/** 筆劃資料可能來自另一個視窗:顏色只接受內建色,座標只接受數字。 */
const clean = s => ({
  tool: s.tool === 'highlight' ? 'highlight' : 'pen',
  color: PEN_COLORS.includes(s.color) ? s.color : PEN_COLORS[0],
  pts: (Array.isArray(s.pts) ? s.pts : []).map(p => [Number(p[0]) || 0, Number(p[1]) || 0, Math.min(1, Math.max(0, Number(p[2]) || 0.6))]),
});

/** 一筆的 SVG 標記(列印與重畫共用)。 */
export function strokeMarkup(raw) {
  const s = clean(raw);
  if (!s.pts.length) return '';
  if (s.tool === 'highlight') return `<path class="ink-hl" d="${linePath(s.pts)}"/>`;
  return `<path class="ink-pen" fill="${s.color}" d="${penPath(s.pts, 7)}"/>`;
}

/** 列印用:整張投影片的畫,沒有就回傳空字串。 */
export function inkMarkup(strokes) {
  return strokes?.length ? `<svg class="ink ink-print" viewBox="0 0 ${W} ${H}" xmlns="${NS}">${strokes.map(strokeMarkup).join('')}</svg>` : '';
}

export class Ink {
  /** onOp(op):本機的變動,要送給另一個視窗。 */
  constructor({ onOp, onChange } = {}) {
    this.store = new Map();   // 投影片編號 → 筆劃
    this.history = new Map(); // 投影片編號 → 復原用的舊版本
    this.tool = 'laser';
    this.color = PEN_COLORS[0];
    this.enabled = false;
    this.onOp = onOp || (() => {});
    this.onChange = onChange || (() => {});
    this.svg = null;
    this.gi = -1;
    this.laserTimer = 0;
  }

  get(gi) { return this.store.get(gi) || []; }

  /** 把畫布放進(重新產生的)投影片外框。 */
  mount(frame, gi) {
    this.svg?.remove();
    this.gi = gi;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.classList.add('ink');
    svg.innerHTML = '<g class="ink-strokes"></g><g class="ink-laser"></g><circle class="ink-dot" r="9" cx="-50" cy="-50"/>';
    frame.append(svg);
    this.svg = svg;
    this.bindPointer(svg);
    this.setEnabled(this.enabled);
    this.redraw();
  }

  setEnabled(on) {
    this.enabled = on;
    this.svg?.classList.toggle('on', on);
    this.svg?.setAttribute('data-tool', this.tool);
    if (!on) this.hideDot();
    this.onChange();
  }

  setTool(tool) {
    this.tool = tool;
    this.svg?.setAttribute('data-tool', tool);
    this.onChange();
  }

  redraw() {
    if (!this.svg) return;
    this.svg.querySelector('.ink-strokes').innerHTML = this.get(this.gi).map(strokeMarkup).join('');
  }

  /** 變更前先存一份,供復原。 */
  remember(gi) {
    const h = this.history.get(gi) || [];
    h.push(this.get(gi).slice());
    if (h.length > 60) h.shift();
    this.history.set(gi, h);
  }

  set(gi, strokes, { local = true } = {}) {
    this.store.set(gi, strokes);
    if (gi === this.gi) this.redraw();
    if (local) this.onOp({ op: 'set', gi, strokes });
    this.onChange();
  }

  undo() {
    const h = this.history.get(this.gi);
    if (h?.length) this.set(this.gi, h.pop());
  }

  clear() {
    if (!this.get(this.gi).length) return;
    this.remember(this.gi);
    this.set(this.gi, []);
  }

  /** 另一個視窗送來的變動。 */
  apply(op) {
    if (op.op === 'set') return this.set(op.gi, op.strokes, { local: false });
    if (op.gi !== this.gi || !this.svg) return;
    if (op.op === 'laser') this.drawLaser(String(op.id).replace(/\W/g, ''), clean({ pts: op.pts }).pts);
    if (op.op === 'laserEnd') this.scheduleLaserFade();
    if (op.op === 'dot') op.x == null ? this.hideDot() : this.showDot(Number(op.x) || 0, Number(op.y) || 0);
  }

  // ---------- 指標 ----------
  point(e) {
    const r = this.svg.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H];
  }

  bindPointer(svg) {
    let cur = null, last = null, erasing = false, frame = 0;
    const send = op => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => this.onOp(op)); };

    svg.addEventListener('click', e => e.stopPropagation());
    svg.addEventListener('pointerdown', e => {
      if (!this.enabled || e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      svg.setPointerCapture(e.pointerId);
      const [x, y] = this.point(e);
      last = { x, y, t: e.timeStamp, p: 0.6 };
      if (this.tool === 'eraser') { erasing = true; this.remember(this.gi); this.eraseAt(x, y); return; }
      if (this.tool === 'laser') { clearTimeout(this.laserTimer); this.svg.querySelector('.ink-laser').style.opacity = 1; }
      cur = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, tool: this.tool, color: this.color, pts: [[x, y, e.pointerType === 'pen' && e.pressure ? e.pressure : 0.6]] };
      this.drawLive(cur);
    });
    svg.addEventListener('pointermove', e => {
      if (!this.enabled) return;
      const [x, y] = this.point(e);
      if (this.tool === 'laser' && !cur) { this.showDot(x, y); send({ op: 'dot', gi: this.gi, x, y }); }
      if (erasing) { this.eraseAt(x, y); return; }
      if (!cur) return;
      const dist = Math.hypot(x - last.x, y - last.y);
      if (dist < 1.5) return;
      // 畫快變細、畫慢變粗;觸控筆有壓力時用真實壓力
      const speed = dist / Math.max(1, e.timeStamp - last.t);
      const p = e.pointerType === 'pen' && e.pressure ? e.pressure : Math.min(1, Math.max(0.15, 1 - speed / 2.2));
      last = { x, y, t: e.timeStamp, p: last.p * 0.6 + p * 0.4 };
      cur.pts.push([x, y, last.p]);
      if (this.tool === 'laser') { this.showDot(x, y); send({ op: 'laser', gi: this.gi, id: cur.id, pts: cur.pts }); }
      this.drawLive(cur);
    });
    const end = () => {
      if (erasing) { erasing = false; this.onOp({ op: 'set', gi: this.gi, strokes: this.get(this.gi) }); this.onChange(); }
      if (!cur) return;
      const s = cur;
      cur = null;
      if (s.tool === 'laser') { this.onOp({ op: 'laser', gi: this.gi, id: s.id, pts: s.pts }); this.onOp({ op: 'laserEnd', gi: this.gi }); this.scheduleLaserFade(); return; }
      this.svg.querySelector(`[data-live="${s.id}"]`)?.remove();
      this.remember(this.gi);
      this.set(this.gi, [...this.get(this.gi), { tool: s.tool, color: s.color, pts: s.pts.map(([x, y, p]) => [round(x), round(y), Math.round(p * 100) / 100]) }]);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', () => { if (!cur) { this.hideDot(); this.onOp({ op: 'dot', gi: this.gi, x: null }); } });
  }

  drawLive(s) {
    if (s.tool === 'laser') return this.drawLaser(s.id, s.pts);
    let el = this.svg.querySelector(`[data-live="${s.id}"]`);
    if (!el) {
      el = document.createElementNS(NS, 'path');
      el.dataset.live = s.id;
      el.setAttribute('class', s.tool === 'highlight' ? 'ink-hl' : 'ink-pen');
      if (s.tool !== 'highlight') el.setAttribute('fill', s.color);
      this.svg.querySelector('.ink-strokes').append(el);
    }
    el.setAttribute('d', s.tool === 'highlight' ? linePath(s.pts) : penPath(s.pts, 7));
  }

  drawLaser(id, pts) {
    const g = this.svg.querySelector('.ink-laser');
    clearTimeout(this.laserTimer);
    g.getAnimations?.().forEach(a => a.cancel());
    g.style.opacity = 1;
    let el = g.querySelector(`[data-id="${id}"]`);
    if (!el) { el = document.createElementNS(NS, 'path'); el.dataset.id = id; g.append(el); }
    el.setAttribute('d', linePath(pts));
  }

  /** 停筆一段時間後,這次畫的雷射線一起淡出。 */
  scheduleLaserFade() {
    clearTimeout(this.laserTimer);
    this.laserTimer = setTimeout(() => {
      const g = this.svg?.querySelector('.ink-laser');
      if (!g) return;
      const a = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LASER_FADE, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = () => { g.innerHTML = ''; a.cancel(); g.style.opacity = 1; };
    }, LASER_IDLE);
  }

  showDot(x, y) { const d = this.svg?.querySelector('.ink-dot'); if (d) { d.setAttribute('cx', round(x)); d.setAttribute('cy', round(y)); } }
  hideDot() { this.showDot(-50, -50); }

  eraseAt(x, y) {
    const strokes = this.get(this.gi);
    const keep = strokes.filter(s => !s.pts.some(([px, py]) => Math.hypot(px - x, py - y) < (s.tool === 'highlight' ? 22 : 14)));
    if (keep.length !== strokes.length) { this.store.set(this.gi, keep); this.redraw(); }
  }
}
