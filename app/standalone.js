// 單一 HTML 檔的入口(由 player/export.js 產生的檔案載入)。
// 簡報資料與媒體都在頁面裡的 <script id="mdslide-data">,不需要網路或伺服器。
//   #/presenter   講者視窗(同一個檔案再開一次)
//   #/<第幾張>     從第幾張開始

import { Player } from './player/player.js';
import { startPresenter } from './player/presenter.js';
import { setLang, getLang, normalizeLang } from './core/i18n.js';

const app = document.getElementById('app');
const data = JSON.parse(document.getElementById('mdslide-data').textContent);

/** 內嵌資料來源:只提供媒體,沒有資料夾可以列(所以播放器不顯示「檢查」)。 */
class EmbeddedSource {
  constructor(media) {
    this.kind = 'embedded';
    this.label = data.deck.title;
    this.media = media || {};
    this.urls = new Map();
  }
  async mediaURL(path) {
    const src = this.media[path];
    if (!src) throw new Error('not embedded: ' + path);
    // 大的 data: 網址換成 blob: 網址,影片拖曳播放比較順
    if (!this.urls.has(path)) this.urls.set(path, fetch(src).then(r => r.blob()).then(b => URL.createObjectURL(b), () => src));
    return this.urls.get(path);
  }
  releaseMedia() {}
}

let lang = null;
try { lang = normalizeLang(localStorage.getItem('leafpile-lang')); } catch { /* file:// 或隱私模式 */ }
setLang(lang || (normalizeLang(navigator.language) === 'zh-Hant' ? 'zh-Hant' : 'en'));
document.documentElement.lang = getLang();

if (location.hash === '#/presenter') {
  startPresenter(app);
} else {
  const [n, view] = location.hash.slice(2).split('/');
  const start = Math.max(0, (parseInt(n, 10) || 1) - 1);
  new Player(app, {
    reading: view === 'read',
    deck: data.deck,
    source: new EmbeddedSource(data.media),
    theme: data.theme,
    start,
    onIndex: (i, read) => history.replaceState(null, '', `#/${i + 1}${read ? '/read' : ''}`),
  });
}
