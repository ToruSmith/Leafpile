// 全螢幕小工具:能用瀏覽器全螢幕就用;不能的(例如 iPhone 的 Safari)只切成「版面模式」,
// 呼叫端用自己的 class 把版面撐滿即可。兩種情況對呼叫端一樣:enter() / exit() / onExit()。

/** 這個瀏覽器能不能真的進全螢幕。 */
export const canFullscreen = () => !!document.documentElement.requestFullscreen;

/** 嘗試讓 el 進全螢幕。失敗(不支援、被拒絕)時靜靜略過,回傳 false。 */
export async function enterFullscreen(el) {
  if (!el?.requestFullscreen) return false;
  try { await el.requestFullscreen(); return true; } catch { return false; }
}

/** 如果現在是全螢幕就退出。 */
export async function exitFullscreen() {
  if (!document.fullscreenElement) return;
  try { await document.exitFullscreen(); } catch { /* 略 */ }
}

/**
 * 全螢幕被使用者用 Esc 關掉時通知一次(自己呼叫 exitFullscreen 也算)。
 * @returns {() => void} 取消監聽
 */
export function onFullscreenExit(el, fn) {
  const h = () => { if (document.fullscreenElement !== el) fn(); };
  document.addEventListener('fullscreenchange', h);
  return () => document.removeEventListener('fullscreenchange', h);
}

/**
 * 浮動按鈕列的「碰一下才出現、過一會自動收起」。
 * show(ms) 顯示 ms 毫秒(預設 4000);滑鼠或焦點在列上時不收;hide() 立刻收。
 */
export function autoHide(bar, { ms = 4000 } = {}) {
  let timer = 0, hover = false;
  // 只有真的滑鼠停在上面、或鍵盤焦點在列上才不收;手指點過之後模擬出來的 hover／focus 不算,否則手機上永遠收不起來
  const keep = () => hover || (bar.contains(document.activeElement) && document.activeElement.matches(':focus-visible'));
  const arm = d => { clearTimeout(timer); timer = setTimeout(() => { if (!keep()) bar.classList.remove('show'); else arm(1500); }, d ?? ms); };
  const show = d => { bar.classList.add('show'); arm(d); };
  const hide = () => { clearTimeout(timer); bar.classList.remove('show'); };
  bar.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { hover = true; clearTimeout(timer); } });
  bar.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { hover = false; arm(900); } });
  bar.addEventListener('click', () => arm(3500));
  return { show, hide, toggle: () => (bar.classList.contains('show') ? hide() : show()), dispose: () => clearTimeout(timer) };
}
