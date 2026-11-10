// 3D 排列。每個排列是一個純函式:輸入目前狀態,輸出每張卡片的位置與整個世界的鏡頭。
// 新增排列:在這裡加一個函式並放進 STAGES,其他程式不用改。
//
// 輸入 ctx:{ slides(攤平,含 sec、i), sections, cur(目前章節), focus(目前投影片全域索引), vw, vh }
// 輸出:{ poses: Pose[], world: { rx, ry, z, scale } }
// Pose:{ x, y, z, rx, ry, rz, s, o, d }   d = 距離目前章節幾疊(洗牌動畫用)

export const CW = 288, CH = 162; // 卡片尺寸(1280×720 的 0.225 倍)

const P = (x, y, z, o = 1, extra = {}) => ({ x, y, z, rx: 0, ry: 0, rz: 0, s: 1, o, d: 0, ...extra });
const deg = r => (r * 180) / Math.PI;

/** 牌堆:目前章節排在最前面,其他章節依序往後疊;換章節時洗牌。 */
function pile({ slides, sections, cur, focus, vw, vh }) {
  const S = sections.length, G = 30;
  const poses = slides.map(s => {
    const d = (s.sec - cur + S) % S;
    const n = sections[s.sec].slides.length;
    const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const c = s.i % cols, r = Math.floor(s.i / cols);
    const isFocus = d === 0 && slides.indexOf(s) === focus;
    return P(
      (c - (cols - 1) / 2) * (CW + G) + d * 110,
      (r - (rows - 1) / 2) * (CH + G) - d * 120,
      -d * 460 + (isFocus ? 60 : 0),
      d === 0 ? 1 : d > 4 ? 0 : Math.max(0.1, 0.38 - (d - 1) * 0.13),
      { d },
    );
  });
  const n = sections[cur].slides.length;
  const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4, rows = Math.ceil(n / cols);
  const scale = Math.min(1.3, (vw - 120) / (cols * (CW + G) + 260), (vh - 200) / (rows * (CH + G) + 140));
  return { poses, world: { rx: 7, ry: -9, z: 0, scale } };
}

/** Coverflow:目前那張正對觀眾,左右兩側斜著往後退。 */
function coverflow({ slides, focus, vw, vh }) {
  const poses = slides.map((_, i) => {
    const k = i - focus, a = Math.abs(k), sg = Math.sign(k);
    if (k === 0) return P(0, 0, 160, 1);
    return P(sg * (190 + (a - 1) * 64), 0, -a * 26 - 60, a > 12 ? 0 : 1 - a * 0.05, { ry: -sg * 62 });
  });
  return { poses, world: { rx: 0, ry: 0, z: 0, scale: Math.min(1.6, (vw - 80) / 900, (vh - 220) / 260) } };
}

/** 圓柱書架:所有投影片圍成一圈,轉到目前那張。 */
function carousel({ slides, focus, vw, vh }) {
  const N = slides.length;
  const step = Math.min((2 * Math.PI) / N, 0.42);
  const r = Math.max(420, (CW + 36) / (2 * Math.sin(step / 2)));
  const poses = slides.map((_, i) => {
    let a = (i - focus) * step;
    if (step * N >= 2 * Math.PI - 1e-6) a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const visible = Math.abs(a) < Math.PI * 0.62;
    return P(r * Math.sin(a), 0, r * Math.cos(a) - r, visible ? 1 - Math.abs(a) / Math.PI * 0.6 : 0, { ry: deg(a) });
  });
  return { poses, world: { rx: -8, ry: 0, z: -60, scale: Math.min(1.35, (vw - 80) / 1100, (vh - 220) / 320) } };
}

/** 螺旋:沿著時間往下旋轉,適合依日期或順序講述。 */
function helix({ slides, focus, vw, vh }) {
  const r = 520, step = 0.36;
  const poses = slides.map((_, i) => {
    const k = i - focus, a = k * step;
    const visible = Math.abs(a) < Math.PI * 0.75;
    return P(r * Math.sin(a), k * 30, r * Math.cos(a) - r, visible ? Math.max(0.15, 1 - Math.abs(a) / (Math.PI * 0.75)) : 0, { ry: deg(a) });
  });
  return { poses, world: { rx: -10, ry: 0, z: -40, scale: Math.min(1.3, (vw - 80) / 1250, (vh - 220) / 380) } };
}

/** 球體:費氏螺旋均勻分布,世界旋轉讓目前那張轉到正前方。 */
function sphere({ slides, focus, vw, vh }) {
  const N = slides.length;
  const R = Math.max(380, Math.sqrt(N) * 92);
  const pts = slides.map((_, i) => {
    const phi = Math.acos(-1 + (2 * (i + 0.5)) / N);
    const theta = Math.sqrt(N * Math.PI) * phi;
    return [R * Math.sin(phi) * Math.cos(theta), R * Math.cos(phi), R * Math.sin(phi) * Math.sin(theta)];
  });
  const poses = pts.map(([x, y, z]) => P(x, y, z, 1, { ry: deg(Math.atan2(x, z)), rx: -deg(Math.atan2(y, Math.hypot(x, z))) }));
  const [fx, fy, fz] = pts[focus] || [0, 0, R];
  const world = { ry: -deg(Math.atan2(fx, fz)), rx: deg(Math.atan2(fy, Math.hypot(fx, fz))), z: -R + 120, scale: Math.min(1.2, (vw - 80) / 1000, (vh - 200) / 520), order: 'sphere' };
  return { poses, world };
}

/** 總覽:章節攤開成欄,一眼看完整份簡報。 */
function overview({ slides, sections, focus, vw, vh }) {
  const per = 7, G = 24, colW = CW + 26;
  const widths = sections.map(s => Math.ceil(s.slides.length / per));
  const totalCols = widths.reduce((a, b) => a + b, 0) + (sections.length - 1) * 0.35;
  const starts = [];
  widths.reduce((x, w) => { starts.push(x); return x + w + 0.35; }, 0);
  const rows = Math.min(per, Math.max(...sections.map(s => s.slides.length)));
  const poses = slides.map((s, gi) => {
    const col = starts[s.sec] + Math.floor(s.i / per), row = s.i % per;
    return P((col - (totalCols - 1) / 2) * colW, (row - (rows - 1) / 2) * (CH + G), gi === focus ? 40 : 0, 1);
  });
  const scale = Math.min(1, (vw - 80) / (totalCols * colW + 40), (vh - 190) / (rows * (CH + G)));
  return { poses, world: { rx: 0, ry: 0, z: 0, scale } };
}

/** 對照:目前那張放大在一側,其他投影片排成縮圖列(橫放在左、直放在下),像簡報軟體的編輯畫面。
 *  目前那張會從縮圖列「抽出來」放大,列上留一個小空位;不同章節之間多留一點間隔。 */
function side({ slides, focus, vw, vh }) {
  const ox = 0, oy = vh * 0.53;            // 世界原點在畫面的 (50%, 53%)
  const short = vh < 500; // 手機橫放
  const top = vw < 600 || short ? 64 : 84, bottom = short ? 22 : 44, pad = vw < 600 || short ? 12 : 24, G = short ? 8 : 12;
  const H = vh - top - bottom;              // 可用高度
  const landscape = vw >= vh * 1.1;
  const at = (px, py) => [px - vw / 2 - ox, py - oy]; // 螢幕座標 → 世界座標
  const secGap = (i, f) => (slides[i].sec - slides[f].sec) * G * 1.5;
  let big, place;
  if (landscape) {
    const tw = Math.max(110, Math.min(220, vw * 0.17)), th = tw * CH / CW;
    const bw = Math.min(vw - tw - pad * 4, (H - pad) * CW / CH), bh = bw * CH / CW;
    const bx = pad * 2 + tw + (vw - tw - pad * 3 - bw) / 2 + bw / 2;
    const limit = H / 2 - th / 2; // 縮圖整張都在頂列與底列之間才顯示
    big = P(...at(bx, top + H / 2), 0, 1, { s: bw / CW });
    place = (k, i) => {
      const y = top + H / 2 + (k - Math.sign(k) * 0.4) * (th + G) + secGap(i, focus);
      const visible = Math.abs(y - (top + H / 2)) <= limit;
      return P(...at(pad + tw / 2, y), 0, visible ? 1 : 0, { s: tw / CW });
    };
  } else {
    const bw = vw - pad * 2, bh = bw * CH / CW;
    const tw = Math.max(96, Math.min(180, vw * 0.3)), th = tw * CH / CW;
    const by = top + Math.max(0, (H - bh - th - G * 3) / 2) + bh / 2;
    big = P(...at(vw / 2, by), 0, 1, { s: bw / CW });
    place = (k, i) => {
      const x = vw / 2 + (k - Math.sign(k) * 0.4) * (tw + G) + secGap(i, focus);
      const visible = Math.abs(x - vw / 2) < vw / 2 + tw; // 左右超出畫面的自然被裁掉
      return P(...at(x, by + bh / 2 + G * 2 + th / 2), 0, visible ? 1 : 0, { s: tw / CW });
    };
  }
  const poses = slides.map((_, i) => (i === focus ? big : place(i - focus, i)));
  return { poses, world: { rx: 0, ry: 0, z: 0, scale: 1 } };
}

export const STAGES = {
  // 顯示名稱在 locales 的 stage.<名稱>
  pile: { fn: pile, shuffle: true },
  coverflow: { fn: coverflow },
  carousel: { fn: carousel },
  helix: { fn: helix },
  sphere: { fn: sphere },
  overview: { fn: overview },
  side: { fn: side },
};
export const STAGE_ORDER = ['pile', 'coverflow', 'carousel', 'helix', 'sphere'];

export function poseTransform(p) {
  return `translate3d(${p.x}px, ${p.y}px, ${p.z}px) rotateY(${p.ry}deg) rotateX(${p.rx}deg) rotateZ(${p.rz}deg) scale(${p.s})`;
}

export function worldTransform(w) {
  return `scale(${w.scale}) translateZ(${w.z}px) rotateX(${w.rx}deg) rotateY(${w.ry}deg)`;
}
