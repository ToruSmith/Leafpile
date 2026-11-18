// Google 登入(只在瀏覽器裡用):按需要才載入 Google 的登入腳本(accounts.google.com/gsi/client),
// 取得只能存取 Leafpile 自己檔案的通行證(drive.file)。通行證只存在這個分頁(sessionStorage),約一小時後過期。
//
// 瀏覽器只在「使用者剛按下按鈕」時才允許跳出 Google 的登入視窗,所以:
//   - 首頁的按鈕先呼叫 preload() 把腳本載好,按下去時就能立刻開視窗;
//   - 用到一半過期時,由 google.ask(main.js 設定的小對話框)請使用者按一下「繼續」再開視窗。

import { GOOGLE } from '../config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const KEY = 'leafpile-google-token';
let loading = null, client = null, pending = null;

export const googleEnabled = () => !!GOOGLE.clientId;

export function preload() {
  if (!googleEnabled()) return Promise.resolve(false);
  loading ||= new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.oauth2) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => { loading = null; reject(new Error('gis')); };
    document.head.append(s);
  });
  return loading;
}

function saved() {
  try {
    const t = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return t && t.exp > Date.now() + 60_000 ? t.token : '';
  } catch { return ''; }
}

export const signedIn = () => !!saved();

export function signOut() {
  const token = saved();
  try { sessionStorage.removeItem(KEY); } catch { /* 無痕視窗等 */ }
  if (token) globalThis.google?.accounts?.oauth2?.revoke?.(token, () => {});
}

/** 開 Google 的登入視窗(要在按鈕的點擊裡呼叫)。回傳通行證;使用者關掉視窗就丟出 'denied'。 */
export function signIn({ prompt = '' } = {}) {
  if (!globalThis.google?.accounts?.oauth2) return Promise.reject(new Error('gis'));
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    client ||= google.accounts.oauth2.initTokenClient({ client_id: GOOGLE.clientId, scope: SCOPE, callback: () => {} });
    client.callback = r => {
      pending = null;
      if (r.error || !r.access_token) return reject(new Error('denied'));
      try { sessionStorage.setItem(KEY, JSON.stringify({ token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 })); } catch { /* 存不了就只用這一次 */ }
      resolve(r.access_token);
    };
    client.error_callback = () => { pending = null; reject(new Error('denied')); };
    client.requestAccessToken({ prompt });
  });
  return pending;
}

/** 給 driveClient 用的 auth:過期時先問使用者(需要一次點擊),再開登入視窗。 */
export const auth = {
  ask: null, // async () => boolean,由 main.js 設定
  async token() {
    const t = saved();
    if (t) return t;
    return this.renew();
  },
  async renew() {
    try { sessionStorage.removeItem(KEY); } catch { /* 略過 */ }
    await preload();
    if (globalThis.navigator?.userActivation && !navigator.userActivation.isActive) {
      if (!this.ask || !(await this.ask())) throw new Error('denied');
    }
    return signIn();
  },
};
