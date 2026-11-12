"""瀏覽器冒煙測試(CI 用,也可以本機跑)。

需要:pip install playwright && python -m playwright install chromium
用法:先在倉庫根目錄執行 node scripts/build-catalog.mjs 並啟動靜態伺服器,再執行
      python tests/smoke/smoke.py http://localhost:8000/ [chromium|firefox|webkit]
"""
import os, sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8000/'
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
# 外部網站(YouTube 縮圖等)在 CI 或離線時可能連不上,不算錯誤
# 外部嵌入網站(影片、CodePen 等)的錯誤取決於測試機的網路,不算網站本身的問題
IGNORE = ('ytimg.com', 'youtube', 'bilibili', 'codepen', 'vimeo', 'ERR_TUNNEL', 'ERR_NAME_NOT_RESOLVED', 'ERR_INTERNET_DISCONNECTED', 'net::ERR')
LOCAL = ('localhost', '127.0.0.1')

def main():
    errors = []
    with sync_playwright() as p:
        # SMOKE_BROWSER_PATH:用系統已安裝的瀏覽器(沒有下載 Playwright 瀏覽器時)
        exe = os.environ.get('SMOKE_BROWSER_PATH')
        browser = getattr(p, ENGINE).launch(**({'executable_path': exe, 'args': ['--no-sandbox']} if exe else {}))
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        # 內容安全政策(CSP):任何違規都算錯誤
        ctx.add_init_script("window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI))")
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        def on_console(m):
            src = (m.location or {}).get('url', '')
            if m.type != 'error' or any(k in m.text for k in IGNORE): return
            if src and not any(h in src for h in LOCAL): return  # 錯誤來自外部網站的框框
            errors.append(f'console: {m.text}')
        page.on('console', on_console)

        page.goto(BASE); page.wait_for_timeout(1500)
        assert page.locator('.hero').count() == 1, '首頁沒有載入'
        page.goto(BASE + '#/repo'); page.wait_for_timeout(2000)
        assert page.locator('.deck-card').count() >= 3, '內建書庫沒有載入'
        page.fill('.search', 'feature tour'); page.wait_for_timeout(200)
        assert page.locator('.deck-card:not([hidden])').count() == 1, '搜尋沒有篩選簡報'
        page.fill('.search', ''); page.wait_for_timeout(200)

        # ---------- Leafpile:書架、筆記、連結、指令面板、快閃播放 ----------
        assert page.locator('.note-row').count() >= 2 and page.locator('.book-card').count() >= 2, '書架沒有筆記與筆記本'
        assert page.locator('.urgent li').count() >= 1, '急件沒有置頂'
        page.click('.segmented [data-view=notes]'); page.wait_for_timeout(200)
        assert page.locator('.deck-card:not([hidden])').count() == 0, '切到「筆記」後不應顯示簡報'
        page.click('.segmented [data-view=all]'); page.wait_for_timeout(200)
        page.click('.segmented [data-view=table]'); page.wait_for_timeout(800)  # 表格檢視(唯讀)
        assert page.locator('.note-table tbody tr').count() >= 5 and not page.locator('.topics').is_visible(), '表格檢視沒有列出筆記'
        page.click('.note-table [data-sort=title]'); page.wait_for_timeout(200)
        assert page.locator('.note-table th[aria-sort=ascending]').count() == 1, '表格沒有依標題排序'
        page.click('.seg-mini [data-mode=topics]'); page.wait_for_timeout(300)  # 主題清單(內建範例是唯讀:沒有編輯鈕)
        assert page.locator('.topic-table tbody tr').count() >= 5, '表格的主題模式沒有列出主題'
        assert page.locator('.tm-edit').count() == 0, '唯讀書庫不該有編輯主題的按鈕'
        page.click('.seg-mini [data-mode=notes]'); page.wait_for_timeout(200)
        page.click('.segmented [data-view=all]'); page.wait_for_timeout(200)
        # 側邊欄:在書庫頁點主題要能展開(書庫頁外層也有 data-view,曾經把點擊攔下來)
        topic = page.locator('.side-nav .sn-tree details:not(.sn-cat)').first
        assert not topic.evaluate('d => d.open'), '主題一開始應該是收起的'
        topic.locator('> summary').click(); page.wait_for_timeout(200)
        assert topic.evaluate('d => d.open'), '在書庫頁點側邊欄的主題沒有展開'
        topic.locator('> summary').click(); page.wait_for_timeout(200)
        page.fill('.search', '雙向同步'); page.wait_for_timeout(300)  # 只出現在內文裡
        assert page.locator('.results li').count() >= 1, '全文搜尋沒有結果'
        page.fill('.search', ''); page.wait_for_timeout(200)
        page.locator('.book-card').first.click(); page.wait_for_timeout(1500)
        assert page.locator('.note-article h1').count() == 1, '筆記沒有打開'
        # 側邊欄打開時,沒有章節清單的筆記也不能被擠到窄欄
        w = page.evaluate("document.querySelector('.note-article').getBoundingClientRect().width")
        assert w > 500, f'側邊欄打開時內文太窄:{w}'
        assert '/n/' in page.url, f'筆記網址不對:{page.url}'
        # 側邊欄(書庫導覽):目前這篇自動展開並標出;從樹狀目錄換到同一本的第 2 篇
        assert page.locator('.side-nav .sn-tree [aria-current=page]').count() == 1, '側邊欄沒有標出目前這篇'
        page.locator('.side-nav .sn-tree a[href*="02-links"]').click(); page.wait_for_timeout(1500)
        assert '02-links' in page.url, f'側邊欄的連結沒有換頁:{page.url}'
        page.wait_for_selector('.backlinks li', timeout=10000)
        assert page.locator('.used-by li').count() >= 1, '沒有顯示「被哪些簡報引用」'
        note_url = page.url
        # 字級(十級)與沉浸閱讀:隱藏頁首與側欄、浮動按鈕列、F 鍵離開
        page.click('.note-tools [data-scale="1"]')
        assert page.locator('.note-tools .val').inner_text() == '112%', '字級沒有放大一級'
        page.click('.note-tools .val')
        assert page.locator('.note-tools .val').inner_text() == '100%', '字級沒有回到 100%'
        page.click('.note-tools .imm'); page.wait_for_timeout(500)
        assert page.evaluate("document.body.classList.contains('immersive')"), '沒有進入沉浸閱讀'
        assert not page.locator('.topbar').is_visible() and page.locator('.rd-bar').is_visible(), '沉浸閱讀應隱藏頁首並顯示浮動按鈕列'
        page.keyboard.press('f'); page.wait_for_timeout(500)
        assert not page.evaluate("document.body.classList.contains('immersive')") and page.locator('.topbar').is_visible(), '按 F 沒有離開沉浸閱讀'
        page.locator('.md a.wikilink').first.click(); page.wait_for_timeout(1500)
        assert '/n/' in page.url and page.url != note_url, f'[[連結]] 沒有帶到另一篇筆記:{page.url}'
        page.keyboard.press('Control+k'); page.wait_for_timeout(300)
        assert page.locator('.palette').count() == 1, 'Ctrl+K 沒有打開指令面板'
        page.keyboard.type('front matter'); page.wait_for_timeout(300)
        page.keyboard.press('Enter'); page.wait_for_timeout(1500)
        assert 'front-matter-cheatsheet' in page.url, f'指令面板沒有開啟筆記:{page.url}'
        assert page.locator('.md table').count() == 1, '筆記裡的表格沒有顯示'
        page.go_back(); page.wait_for_timeout(1200)
        page.keyboard.press('p'); page.wait_for_timeout(2500)  # 快閃播放
        assert '/f/' in page.url and page.locator('.card').count() >= 3, f'快閃播放沒有啟動:{page.url}'
        assert page.locator('[data-act=check]').count() == 0, '快閃播放不應有檢查按鈕'
        page.keyboard.press('ArrowRight'); page.keyboard.press('Enter'); page.wait_for_timeout(1200)
        assert page.locator('.frame .slide').count() == 1, '快閃播放無法放大'
        page.keyboard.press('e'); page.wait_for_timeout(500)
        assert page.locator('.editor').count() == 0, '快閃播放不應能編輯投影片'
        page.keyboard.press('Escape'); page.keyboard.press('Escape'); page.wait_for_timeout(1000)
        assert '/n/' in page.url, f'離開快閃播放後應回到筆記:{page.url}'
        page.keyboard.press('e'); page.wait_for_timeout(1200)  # 筆記編輯(倉庫模式唯讀,預覽照樣更新)
        assert page.locator('.ne-text').count() == 1 and page.locator('.ne-readonly').count() == 1, '筆記編輯頁沒有打開'
        page.evaluate("() => { const ta = document.querySelector('.ne-text'); ta.removeAttribute('readonly'); ta.value = '# 預覽\\n\\n[[兩個渠道]]'; ta.dispatchEvent(new Event('input')); }")
        page.wait_for_timeout(600)
        assert page.locator('.ne-preview h1').inner_text() == '預覽' and page.locator('.ne-preview .wikilink').count() == 1, '筆記預覽沒有更新'
        page.evaluate("() => { const ta = document.querySelector('.ne-text'); ta.setAttribute('readonly', ''); }")
        page.goto(BASE + '#/repo'); page.wait_for_timeout(600)
        if page.locator('.lp-dialog').count(): page.locator('.lp-dialog .primary').click(); page.wait_for_timeout(600)  # 還沒存檔就離開:確認
        page.wait_for_timeout(1200)
        # Mdslide Pile 的舊網址仍然可以用
        page.goto(BASE + '#/repo/00-examples/2026-11-minimal/2'); page.wait_for_timeout(2500)
        assert '/d/00-examples/2026-11-minimal' in page.url and page.locator('.card').count() >= 5, f'舊網址沒有轉到新網址:{page.url}'
        page.goto(BASE + '#/repo'); page.wait_for_timeout(2000)

        # ---------- 簡報(沿用 Mdslide Pile 的冒煙測試) ----------
        page.fill('.search', 'feature tour'); page.wait_for_timeout(300)
        page.locator('.deck-card:not([hidden])').first.click(); page.wait_for_timeout(2500)
        assert page.locator('.card').count() > 10, '播放器沒有載入'

        before = page.evaluate("[...document.querySelectorAll('.card')].slice(0, 8).map(c => getComputedStyle(c).transform)")
        for key in ['ArrowRight', 'Enter', 'Escape', 'l', 't', 'o', 'o', 'ArrowDown']:
            page.keyboard.press(key); page.wait_for_timeout(700)
        page.wait_for_timeout(1600)
        after = page.evaluate("[...document.querySelectorAll('.card')].slice(0, 8).map(c => getComputedStyle(c).transform)")
        assert before != after, '換章節後卡片位置沒有改變(洗牌動畫可能失效)'
        # 畫筆(D):在放大的投影片上畫一筆,Esc 關閉
        page.keyboard.press('d'); page.wait_for_timeout(900)
        fb = page.locator('.frame').bounding_box()
        page.click('.ink-bar [data-ink=pen]')
        page.mouse.move(fb['x'] + 300, fb['y'] + 400); page.mouse.down()
        for i in range(1, 15): page.mouse.move(fb['x'] + 300 + i * 12, fb['y'] + 400)
        page.mouse.up(); page.wait_for_timeout(200)
        assert page.locator('.frame .ink-strokes path').count() == 1, '畫筆沒有留下筆跡'
        page.keyboard.press('Escape'); page.keyboard.press('Escape'); page.wait_for_timeout(700)
        # 點圖片放大
        img_at = page.evaluate("[...document.querySelectorAll('.card')].findIndex(c => c.querySelector('img[data-media]:not(.logo)'))")
        if img_at >= 0:
            page.evaluate("n => { location.hash = location.hash.replace(/[/][0-9]+$/, '/' + n) }", img_at + 1); page.wait_for_timeout(900)
            page.keyboard.press('Enter'); page.wait_for_timeout(900)
            page.locator('.frame img[data-media]').first.click(); page.wait_for_timeout(400)
            assert page.locator('.lightbox').count() == 1, '點圖片沒有放大'
            page.keyboard.press('Escape'); page.keyboard.press('Escape'); page.wait_for_timeout(700)
        # 互動網頁:倉庫裡的 .html 放大後可以操作
        page_at = page.evaluate("[...document.querySelectorAll('.card')].findIndex(c => c.querySelector('[data-page]'))")
        if page_at >= 0:
            page.evaluate("n => { location.hash = location.hash.replace(/[/][0-9]+$/, '/' + n) }", page_at + 1); page.wait_for_timeout(900)
            page.keyboard.press('Enter'); page.wait_for_timeout(1200)
            demo = page.frame_locator('.frame figure.page iframe')
            try:
                demo.locator('#out').wait_for(timeout=15000)
            except Exception:
                info = page.evaluate("() => { const f = document.querySelector('.frame figure.page iframe'); return f ? [f.src, f.getAttribute('sandbox')] : 'no iframe' }")
                raise AssertionError(f'互動網頁沒有載入:{info}')
            before_v = demo.locator('#out').inner_text()
            demo.locator('#years').fill('35'); page.wait_for_timeout(300)
            assert demo.locator('#out').inner_text() != before_v, '互動網頁沒有反應'
            here = page.url
            page.locator('.frame h1').first.click(); page.wait_for_timeout(500)  # 點回投影片:拿回鍵盤,不翻頁
            assert page.url == here, '從互動網頁點回投影片時不應翻頁'
            page.keyboard.press('Escape'); page.wait_for_timeout(700)
        # 編輯模式(E):倉庫模式是唯讀,預覽要跟著打字更新
        page.keyboard.press('e'); page.wait_for_timeout(1200)
        assert page.locator('.editor').count() == 1, '編輯模式沒有打開'
        assert page.locator('.efile').inner_text().endswith('.md'), f"編輯的不是 MD 檔:{page.locator('.efile').inner_text()}"
        page.fill('.etext', '# 預覽測試\n\n- 一點\n'); page.wait_for_timeout(600)
        assert page.locator('.escale h1').inner_text() == '預覽測試', '預覽沒有跟著更新'
        page.click('[data-t=look]'); page.wait_for_timeout(300)
        page.select_option('[data-look=size]', 'large'); page.wait_for_timeout(400)
        assert '<!-- size: large -->' in page.input_value('.etext'), '外觀面板沒有寫入設定'
        assert page.locator('.escale .slide.size-large').count() == 1, '外觀面板沒有反映在預覽'
        page.select_option('[data-look=size]', ''); page.wait_for_timeout(400)
        assert 'size:' not in page.input_value('.etext'), '選回預設應該刪掉設定'
        page.select_option('[data-t=layout]', 'center'); page.wait_for_timeout(400)
        assert '<!-- layout: center -->' in page.input_value('.etext'), '版型選單沒有寫入設定'
        assert page.locator('.escale .l-center').count() == 1, '版型選單沒有反映在預覽'
        pos = page.locator('.epos').inner_text()
        page.click('[data-e=next]'); page.wait_for_timeout(500)
        if page.locator('.edialog').count():  # 下一張在別的檔案:唯讀模式要先問(同一個檔案就直接移動游標)
            page.locator('.edialog .pbtn.primary').click(); page.wait_for_timeout(800)  # 不儲存,換到下一張
        assert page.locator('.epos').inner_text() != pos, '下一張按鈕沒有換張'
        page.keyboard.press('Escape'); page.wait_for_timeout(800)
        assert page.locator('.editor').count() == 0, '編輯模式沒有關閉'
        # 輸入頁碼跳轉(G)
        page.keyboard.press('g'); page.wait_for_timeout(200)
        page.keyboard.type('3'); page.keyboard.press('Enter'); page.wait_for_timeout(1000)
        assert page.url.rstrip('/').endswith('/3'), f'G 跳頁後網址應該是第 3 張:{page.url}'

        # 閱讀模式(M)
        page.keyboard.press('m'); page.wait_for_timeout(1000)
        assert page.locator('.reader .ritem').count() == page.locator('.card').count(), '閱讀模式的張數不對'
        assert '/read' in page.url, '閱讀模式的網址沒有 /read'
        page.keyboard.press('Enter'); page.wait_for_timeout(1200)
        assert page.locator('.reader').count() == 0 and page.evaluate("document.querySelector('.player').classList.contains('viewing')"), '閱讀模式按 Enter 沒有放大投影片'
        page.keyboard.press('Escape'); page.wait_for_timeout(900)
        page.keyboard.press('v'); page.wait_for_timeout(1300)
        assert page.evaluate("document.querySelector('.player').dataset.stage") == 'side', 'V 沒有切到對照模式'
        # 動畫在慢機器(CI)上可能還沒跑完:輪詢到大圖放大為止,而不是固定等待
        # (不用 wait_for_function:WebKit 的輪詢會用 eval 執行判斷式,被網站自己的 CSP 擋下,測試會誤報違規)
        for _ in range(24):
            big = page.evaluate("document.querySelector('.card.focus').getBoundingClientRect().width")
            if big > 600:
                break
            page.wait_for_timeout(250)
        assert big > 600, f'對照模式的大圖太小:{big}'
        page.keyboard.press('v'); page.wait_for_timeout(1300)
        errors.extend('csp: ' + v for v in page.evaluate('window.__csp'))

        # 匯出單一 HTML,在全新、離線的瀏覽器設定檔用 file:// 開啟
        import tempfile
        cards = page.locator('.card').count()
        page.click('[data-act=export]')
        page.wait_for_selector('.export-panel [data-x=go]:not([disabled])')
        with page.expect_download() as dl:
            page.click('.export-panel [data-x=go]')
        out = os.path.join(tempfile.mkdtemp(), 'deck.html')
        dl.value.save_as(out)
        offline = browser.new_context(offline=True, viewport={'width': 1280, 'height': 800})
        q = offline.new_page()
        q.on('pageerror', lambda e: errors.append(f'export pageerror: {e}'))
        q.goto('file://' + out); q.wait_for_timeout(2000)
        assert q.locator('.card').count() == cards, '匯出的 HTML 卡片數量不對'
        q.keyboard.press('Enter'); q.wait_for_timeout(800)
        assert q.locator('.frame .slide').count() == 1, '匯出的 HTML 無法放大投影片'
        offline.close()

        # 手機:左右滑換頁(TouchEvent 建構子只有 Chromium 桌面版能用,其他引擎略過)
        if ENGINE == 'chromium':
            mob = browser.new_context(**p.devices['iPhone 13'])
            m = mob.new_page()
            m.on('pageerror', lambda e: errors.append(f'mobile pageerror: {e}'))
            m.goto(page.url.rsplit('/', 1)[0] + '/1'); m.wait_for_timeout(2000)
            assert m.locator('.rotate-hint').count() == 1, '手機直放時沒有提示轉橫向'
            assert m.evaluate("document.querySelector('.stage-select').value") == 'side', '手機沒有預設使用對照模式'
            m.click('.rotate-hint [data-r=ok]'); m.wait_for_timeout(300)
            m.evaluate("""() => { const el = document.querySelector('.stage'); const mk = x => new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 });
              el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [mk(300)], changedTouches: [mk(300)] }));
              el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [mk(60)] })); }""")
            m.wait_for_timeout(800)
            assert m.url.endswith('/2'), f'手機左滑沒有換到下一張:{m.url}'
            assert m.evaluate("document.querySelector('.pbar').scrollWidth <= innerWidth"), '手機工具列超出畫面'
            mob.close()

        # 連不上網路時打開內建範例:顯示看得懂的提示,不是「Failed to fetch」
        net = browser.new_context()
        r = net.new_page()
        r.route('**/catalog.json', lambda route: route.abort('internetdisconnected'))
        r.goto(BASE + '#/repo'); r.wait_for_timeout(1500)
        box = r.locator('.error-box').inner_text() if r.locator('.error-box').count() else ''
        assert ('網路' in box or 'offline' in box.lower()) and 'fetch' not in box.lower(), f'離線提示不對:{box!r}'
        net.close()

        # 離線快取:service worker 接手後,斷網重新整理首頁仍可開啟
        # (Playwright 只有 Chromium 能可靠模擬「有 service worker 時斷網」,其他引擎略過)
        page.goto(BASE); page.evaluate('navigator.serviceWorker.ready'); page.wait_for_timeout(1500)
        if ENGINE != 'chromium':
            pass
        elif page.evaluate('!!navigator.serviceWorker.controller'):
            ctx.set_offline(True)
            page.reload(); page.wait_for_timeout(1500)
            assert page.locator('.hero').count() == 1, '離線時首頁沒有從快取載入'
            ctx.set_offline(False)
        else:
            errors.append('service worker 沒有接手頁面')
        errors.extend('csp: ' + v for v in page.evaluate('window.__csp'))
        browser.close()

    if errors:
        print('\n'.join(errors)); sys.exit(1)
    print(f'smoke OK ({ENGINE})')

main()
