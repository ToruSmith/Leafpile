// embed.html 的程式:等待開啟它的頁面(上層框框或開啟這個分頁的視窗)送來 HTML,放進隔離的框框。
// 只接受同網站送來的訊息;框框裡的網頁是隔離的來源,它送來的訊息一律忽略。
const frame = document.querySelector('iframe');
const host = window.parent !== window ? window.parent : window.opener;

window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== host || e.data?.type !== 'mdslide-embed') return;
  if (e.data.title) document.title = String(e.data.title);
  frame.srcdoc = String(e.data.html);
});

host?.postMessage({ type: 'mdslide-embed-ready' }, location.origin);
