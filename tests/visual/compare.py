"""畫面比對:同一台機器上,把兩個版本的官方範例每一張投影片截圖,找出有變化的地方。

CI 在 PR 上自動執行(比對 PR 與目標分支),結果寫在 Actions 的摘要並附上截圖;
這是提醒用的,不會讓 CI 失敗(加上 --strict 才會)。

需要:pip install playwright pillow && python -m playwright install chromium
用法:python tests/visual/compare.py <舊版網址> <新版網址> <輸出資料夾> [--strict] [--deck 資料夾名稱]
"""
import os, sys, urllib.parse
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops

OLD, NEW, OUT = sys.argv[1:4]
STRICT = '--strict' in sys.argv
ONLY = sys.argv[sys.argv.index('--deck') + 1] if '--deck' in sys.argv else None
TOPIC = '00-官方範例'
VIEW = {'width': 1280, 'height': 816}
THRESHOLD = 0.001  # 超過 0.1% 的像素不同才算有變化(避開抗鋸齒的細微差異)


def decks(page, base):
    page.goto(base + '#/repo'); page.wait_for_timeout(2000)
    hrefs = page.evaluate("[...document.querySelectorAll('.deck-card')].map(a => a.getAttribute('href'))")
    prefix = '#/repo/' + urllib.parse.quote(TOPIC) + '/'
    return [h[len(prefix):] for h in hrefs if h.startswith(prefix)]


def shoot(browser, base, deck, folder):
    """依序放大每一張(含逐步顯示的每一步)並截圖,回傳 [(名稱, 路徑)]。"""
    ctx = browser.new_context(viewport=VIEW, locale='zh-TW', reduced_motion='reduce')
    page = ctx.new_page()
    page.goto(f'{base}#/repo/{urllib.parse.quote(TOPIC)}/{deck}/1'); page.wait_for_timeout(1800)
    total = page.locator('.card').count()
    page.keyboard.press('Enter'); page.wait_for_timeout(900)
    shots, seen = [], {}
    for _ in range(total * 6):  # 上限:每張最多 6 步
        idx = page.url.rsplit('/', 1)[1]
        step = seen.get(idx, 0); seen[idx] = step + 1
        name = f'{urllib.parse.unquote(deck)}-{int(idx):02d}' + (f'-step{step}' if step else '')
        page.wait_for_function("[...document.querySelectorAll('.frame img')].every(i => i.complete)", timeout=5000)
        page.wait_for_timeout(250)
        path = os.path.join(folder, name + '.png')
        page.locator('.frame').screenshot(path=path, animations='disabled')
        shots.append((name, path))
        before = page.url
        page.keyboard.press('ArrowRight'); page.wait_for_timeout(500)
        if page.url == before and int(idx) == total and not page.locator('.frame .step.hidden').count():
            break
    ctx.close()
    return shots


def main():
    os.makedirs(OUT, exist_ok=True)
    changed, notes = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        old_decks, new_decks = decks(page, OLD), decks(page, NEW)
        page.close()
        for d in sorted(set(old_decks) ^ set(new_decks)):
            notes.append(f'- 只在{"新" if d in new_decks else "舊"}版出現的簡報:`{urllib.parse.unquote(d)}`')
        for deck in [d for d in new_decks if d in old_decks and (not ONLY or urllib.parse.unquote(d) == ONLY)]:
            o_dir, n_dir = os.path.join(OUT, 'old'), os.path.join(OUT, 'new')
            os.makedirs(o_dir, exist_ok=True); os.makedirs(n_dir, exist_ok=True)
            old = dict(shoot(browser, OLD, deck, o_dir))
            new = dict(shoot(browser, NEW, deck, n_dir))
            if len(old) != len(new):
                notes.append(f'- `{urllib.parse.unquote(deck)}`:畫面數 {len(old)} → {len(new)}')
            for name in sorted(set(old) & set(new)):
                a, b = Image.open(old[name]).convert('RGB'), Image.open(new[name]).convert('RGB')
                if a.size != b.size:
                    changed.append((name, 1.0)); continue
                diff = ImageChops.difference(a, b)
                bbox = diff.getbbox()
                if not bbox:
                    continue
                mask = diff.convert('L').point(lambda v: 255 if v > 16 else 0)
                ratio = mask.histogram()[255] / (a.size[0] * a.size[1])
                if ratio > THRESHOLD:
                    changed.append((name, ratio))
                    mask.save(os.path.join(OUT, name + '-diff.png'))
        browser.close()

    lines = ['## 畫面比對(官方範例)', '']
    lines += notes
    if changed:
        lines += [f'{len(changed)} 個畫面有變化(截圖在 artifact「visual-diff」):', '']
        lines += [f'- `{n}`:{r:.1%} 的像素不同' for n, r in changed]
    else:
        lines += ['沒有畫面變化。']
    report = '\n'.join(lines) + '\n'
    print(report)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
            f.write(report)
    if STRICT and changed:
        sys.exit(1)


main()
