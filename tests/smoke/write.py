"""可寫入書庫的冒煙測試(只跑 Chromium:其他瀏覽器沒有 File System Access API)。

驗的是「按鈕 → 真的寫進資料夾」這一段,核心邏輯另有單元測試:
  空資料夾起手式 → 記到收件匣 → 刪除(進 _archive/、原位消失)→ 復原。

用 OPFS(瀏覽器內建的私有檔案系統)當成使用者選的資料夾。headless Chromium 從 IndexedDB
讀回資料夾 handle 會當掉,所以「最近開啟」的 store 換成記憶體版。

用法:先啟動靜態伺服器,再執行
      python tests/smoke/write.py http://localhost:8000/
"""
import os, sys, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8000/'

INIT = """
FileSystemHandle.prototype.requestPermission = async () => 'granted';
FileSystemHandle.prototype.queryPermission = async () => 'granted';
window.showDirectoryPicker = async () => {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('lib' + Date.now(), { create: true });
  window.__root = root;
  return root;
};
// 列出資料夾裡所有檔案的相對路徑
window.__files = async () => {
  const out = [];
  const walk = async (d, p) => { for await (const [name, h] of d.entries()) { if (h.kind === 'directory') await walk(h, p + name + '/'); else out.push(p + name); } };
  await walk(window.__root, '');
  return out.sort();
};
window.__read = async path => {
  let d = window.__root; const parts = path.split('/');
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
  return (await (await d.getFileHandle(parts.at(-1))).getFile()).text();
};
"""
STORE = """const MEM = (globalThis.__mem ||= new Map());
export async function listRecent() { return [...MEM.values()]; }
export async function remember(handle) { const id = 'm' + MEM.size; MEM.set(id, { id, name: handle.name, handle, lastOpened: Date.now() }); return id; }
export async function getRecent(id) { return MEM.get(id) || null; }
export async function forget(id) { MEM.delete(id); }
export async function ensurePermission() { return true; }
"""

def main():
    errors = []
    with sync_playwright() as p:
        exe = os.environ.get('SMOKE_BROWSER_PATH')
        browser = p.chromium.launch(**({'executable_path': exe, 'args': ['--no-sandbox']} if exe else {}))
        ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, locale='zh-TW', service_workers='block')
        ctx.add_init_script(INIT)
        ctx.route('**/app/sources/store.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=STORE))
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        page.on('console', lambda m: errors.append(f'console: {m.text}') if m.type == 'error' and 'net::ERR' not in m.text else None)
        files = lambda: page.evaluate('window.__files()')
        rows = lambda: page.locator('.note-row').count()
        def until(cond, what, ms=12000):
            # 輪詢等條件成立;寫檔很快,但書架重新索引在慢機器上要好幾秒
            for _ in range(ms // 200):
                if cond(): return
                page.wait_for_timeout(200)
            raise AssertionError(what)

        # 1. 空資料夾 → 起手式「用範例開始」
        page.goto(BASE); page.wait_for_timeout(600)
        page.click('.open-folder')
        page.wait_for_selector('[data-setup=sample]', timeout=8000)
        assert files() == [], '測試用的資料夾應該是空的'
        page.click('[data-setup=sample]')
        page.wait_for_selector('.note-row', timeout=8000)
        fs = files()
        for need in ('_site.yml', 'notes/01-inbox/_topic.yml', 'slides/01-inbox/_topic.yml', 'notes/01-inbox/welcome.md'):
            assert need in fs, f'起手式沒有建立 {need}:{fs}'

        # 2. 記到收件匣(Alt+N)
        page.keyboard.press('Alt+KeyN')
        page.wait_for_selector('.lp-dialog textarea', timeout=4000)
        page.fill('.lp-dialog textarea', '冒煙測試的一句話\n第二行內容')
        page.click('.lp-dialog .primary')
        until(lambda: len(files()) > 4, '記到收件匣沒有寫出新檔案')
        cap = [f for f in files() if f.startswith('notes/01-inbox/') and f.endswith('.md') and 'welcome' not in f]
        assert len(cap) == 1, f'記到收件匣沒有產生新筆記:{files()}'
        assert '冒煙測試的一句話' in page.evaluate('p => window.__read(p)', cap[0]), '收件匣筆記內容不對'
        until(lambda: rows() == 2, '書架沒有出現新筆記')
        before = 2

        # 3. 刪除:進 _archive/、原位消失、書架少一篇
        page.locator('.note-row [data-del=note]').first.click(force=True)
        page.wait_for_selector('.lp-dialog .primary', timeout=4000)
        page.click('.lp-dialog .primary')
        until(lambda: any(f.startswith('_archive/') for f in files()), '刪除沒有搬到 _archive/')
        fs = files()
        gone = [f for f in ('notes/01-inbox/welcome.md', cap[0]) if f not in fs]
        assert len(gone) == 1, f'刪除後原位應該少一篇:{fs}'
        until(lambda: rows() == before - 1, '刪除後書架沒有更新')
        archived = [f for f in fs if f.startswith('_archive/') and f.endswith('.md')]
        assert len(archived) == 1, f'_archive/ 只該有被刪的那篇:{archived}'

        # 4. 復原:搬回原位、_archive/ 清空、書架回到原樣
        page.locator('.lp-toast-actions button', has_text='復原').first.click()
        until(lambda: not any(f.startswith('_archive/') and f.endswith('.md') for f in files()), '復原後 _archive/ 還有檔案')
        fs = files()
        assert 'notes/01-inbox/welcome.md' in fs and cap[0] in fs, f'復原沒有搬回原位:{fs}'
        assert not any(f.startswith('_archive/') and f.endswith('.md') for f in fs), f'復原後 _archive/ 還有檔案:{fs}'
        until(lambda: rows() == before, '復原後書架沒有回到原樣')

        browser.close()
    if errors:
        print('FAIL', *errors, sep='\n  '); sys.exit(1)
    print('write smoke OK (chromium)')

main()
