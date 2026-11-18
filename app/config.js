// 維護者設定(由架這個網站的人填一次,所有使用者共用)。
//
// Google Drive 書庫與分享連結(實驗):
//   clientId:Google Cloud「OAuth 用戶端 ID」(網頁應用程式)
//   apiKey:  Google Cloud「API 金鑰」,只開 Google Drive API、限制在這個網站的網址
// 兩者都不是密碼,可以公開:Google 只接受從登記過的網址使用。留空就不顯示 Google Drive 的功能。
// 步驟見 docs/GOOGLE-DRIVE.md。
//
// 測試用:在瀏覽器主控台執行
//   localStorage.setItem('leafpile-google', JSON.stringify({ clientId: '…', apiKey: '…' }))
// 可以暫時覆蓋這裡的值(只影響那個瀏覽器)。

const fixed = { clientId: '10035283080-89vrlpikp53jk211jceeoebr3f6k1qtb.apps.googleusercontent.com
', apiKey: 'AIzaSyDwpMd2xw6L5MqzE9hMvGJTLZW0NLr08RE' };

let override = null;
try { override = JSON.parse(globalThis.localStorage?.getItem('leafpile-google') || 'null'); } catch { /* 沒有或格式錯:用上面的值 */ }

export const GOOGLE = {
  clientId: String(override?.clientId || fixed.clientId || ''),
  apiKey: String(override?.apiKey || fixed.apiKey || ''),
};
