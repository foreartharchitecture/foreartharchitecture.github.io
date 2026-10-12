# Browser test against wrangler dev + mock upstreams. Run: python3 dev/ui_test.py
import json, os, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:8787')
MOCK = 'http://127.0.0.1:8790'
OUT = os.environ.get('OUT', '/tmp/fs-shots'); os.makedirs(OUT, exist_ok=True)
FOUNDER = ('arjun', 'even better password', 'arjun@example.com')
STAFF = ('faris', 'new faris password', 'faris@example.com')
results = []
def check(cond, name, extra=''):
    results.append((bool(cond), name)); print(('  ✓ ' if cond else '  ✗ ') + name + ('' if cond else f'  {extra}'))
def last_code(to):
    with urllib.request.urlopen(f'{MOCK}/mail/last?to={to}') as r: m = json.load(r)
    return (m.get('subject') or '')[:6], m.get('at', 0)

def sign_in(page, who, remember=True):
    user, pw, email = who
    page.goto(BASE + '/login')
    page.fill('#login', user); page.fill('#pw', pw)
    before = time.time() * 1000
    page.click('button[type=submit]')
    page.wait_for_selector('#code, #msg.good', timeout=20000)
    if page.query_selector('#code'):
        for _ in range(40):
            code, at = last_code(email)
            if at >= before - 2000: break
            time.sleep(0.25)
        if not remember: page.uncheck('#remember')
        page.fill('#code', code)  # auto-submits at 6 digits
    page.wait_for_url(BASE + '/', timeout=20000)

def run():
    with sync_playwright() as p:
        b = p.chromium.launch()
        # ---------------- founder on desktop ----------------
        print('Founder · desktop')
        ctx = b.new_context(viewport={'width': 1440, 'height': 960}, color_scheme='dark', bypass_csp=True)
        page = ctx.new_page(); errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE + '/login'); page.wait_for_timeout(400)
        page.screenshot(path=f'{OUT}/01-login.png')
        sign_in(page, FOUNDER)
        page.wait_for_function("document.querySelector('#sync-n')?.dataset.s === 'live'", timeout=30000)
        check(True, 'Notion sync shows live')
        page.wait_for_timeout(1500)
        page.screenshot(path=f'{OUT}/02-overview.png', full_page=False)
        check(page.is_visible('#tab-crm') and page.is_visible('#tab-finance'), 'founder sees all sections')
        check(page.is_visible('.acct'), 'account button in header')
        # finance: xlsx + docx extraction in the browser
        page.click('#tab-finance'); page.wait_for_timeout(500)
        page.click('[data-act="goto"][data-view="accounts"]')
        page.wait_for_function("document.querySelector('#view-accounts') && /6 in · 6 out/.test(document.querySelector('#view-accounts').innerText)", timeout=30000)
        acc = page.inner_text('#view-accounts')
        check('6 in · 6 out' in acc and '₹96,000' in acc and '30.09.2026' in acc, 'income and expense rows parsed from the Excel workbook (dates, amounts)', acc[:300])
        page.screenshot(path=f'{OUT}/03-accounts.png')
        page.click('[data-act="goto"][data-view="invoices"]')
        page.wait_for_function("/FE\\/INV\\/2026\\/01[34]|85,000|1,20,000/.test(document.querySelector('#view-invoices').innerText)", timeout=30000)
        inv = page.inner_text('#view-invoices')
        check('85,000' in inv or '1,20,000' in inv, 'invoice amounts read from Word files (partial download)', inv[:400])
        page.screenshot(path=f'{OUT}/04-invoices.png')
        # two-way sync: complete a task
        page.click('#tab-studio'); page.click('[data-act="goto"][data-view="tasks"]'); page.wait_for_timeout(800)
        btn = page.query_selector('[data-act="task-done"]')
        check(btn is not None, 'task done button available to founders')
        if btn:
            btn.click(); page.wait_for_selector('.toast', timeout=10000)
            check('marked done' in page.inner_text('#toasts').lower(), 'task completion saved to Notion', page.inner_text('#toasts'))
        page.screenshot(path=f'{OUT}/05-tasks.png')
        # AI brief
        page.goto(BASE + '/?view=studio-ov'); page.wait_for_timeout(1500)
        ai = page.query_selector('[data-act="ai-brief"]')
        check(ai is not None, 'AI brief button shown (API key configured)')
        if ai:
            ai.click(); page.wait_for_function("document.body.innerText.includes('FE-100-65')", timeout=15000)
            check(True, 'AI brief streamed')
        # access panel
        page.click('.acct'); page.wait_for_selector('.amenu')
        page.screenshot(path=f'{OUT}/06-menu.png')
        page.click('.amenu [data-a="access"]'); page.wait_for_selector('.urow', timeout=10000)
        page.wait_for_timeout(300)
        page.screenshot(path=f'{OUT}/07-access.png')
        check('Faris K' in page.inner_text('.apanel'), 'access panel lists staff')
        page.click('[data-tab="system"]'); page.wait_for_selector('.chk-row', timeout=15000); page.wait_for_timeout(300)
        page.screenshot(path=f'{OUT}/08-status.png')
        check(page.eval_on_selector_all('.chk-row i.no', 'n => n.length') == 0, 'system status all connected')
        page.keyboard.press('Escape')
        # manifest + service worker
        man = page.evaluate("fetch('/manifest.webmanifest').then(r => r.json())")
        check(man['display'] == 'standalone' and len(man['icons']) >= 3, 'web app manifest')
        page.wait_for_timeout(1000)
        sw = page.evaluate("navigator.serviceWorker.getRegistration().then(r => !!(r && (r.active || r.installing || r.waiting)))")
        check(sw, 'service worker registered')
        real = [e for e in errors if 'favicon' not in e and 'fonts.g' not in e and 'ERR_' not in e]
        check(not real, 'no script errors (founder)', real[:5])
        ctx.close()

        # ---------------- staff on a phone ----------------
        print('Staff · iPhone width')
        iphone = p.devices['iPhone 13']
        ctx = b.new_context(**iphone, color_scheme='light', bypass_csp=True)
        page = ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        sign_in(page, STAFF)
        page.wait_for_function("document.querySelector('#sync-n')?.dataset.s === 'live'", timeout=30000)
        page.wait_for_timeout(1200)
        page.screenshot(path=f'{OUT}/09-staff-phone.png')
        check(not page.is_visible('#tab-crm') and not page.is_visible('#tab-finance') and not page.is_visible('#tab-overview'), 'staff sees only Studio')
        check(page.query_selector('[data-act="task-done"]') is None or not page.is_visible('[data-act="task-done"]'), 'no edit buttons for staff')
        page.goto(BASE + '/?view=pipeline'); page.wait_for_timeout(800)
        check(page.evaluate("!document.querySelector('#view-pipeline') || document.querySelector('#view-pipeline').hidden"), 'deep link to CRM falls back for staff')
        page.click('.acct'); page.wait_for_selector('.amenu')
        menu = page.inner_text('.amenu')
        check('Manage access' not in menu and 'Install app' in menu, 'staff menu: no access management; install offered on iPhone', menu)
        page.click('.amenu [data-a="install"]'); page.wait_for_selector('.ios-steps')
        page.screenshot(path=f'{OUT}/10-ios-install.png')
        page.keyboard.press('Escape')
        real = [e for e in errors if 'favicon' not in e and 'fonts.g' not in e and 'ERR_' not in e and '403' not in e]
        check(not real, 'no script errors (staff)', real[:5])
        # sign out
        page.click('.acct'); page.click('.amenu [data-a="out"]'); page.wait_for_url(BASE + '/login', timeout=10000)
        check(True, 'sign out returns to login')
        page.goto(BASE + '/'); check(page.url.endswith('/login'), 'signed-out app redirects to login')
        ctx.close()

        # ---------------- founder on Android width ----------------
        print('Founder · Android width')
        ctx = b.new_context(**p.devices['Pixel 7'], color_scheme='dark', bypass_csp=True)
        page = ctx.new_page(); sign_in(page, FOUNDER)
        page.wait_for_function("document.querySelector('#sync-n')?.dataset.s === 'live'", timeout=30000); page.wait_for_timeout(1200)
        page.screenshot(path=f'{OUT}/11-founder-android.png')
        sw_w = page.evaluate('document.documentElement.scrollWidth'); vw = page.evaluate('innerWidth')
        check(sw_w <= vw + 1, 'no sideways scroll on phone', f'{sw_w} > {vw}')
        ctx.close(); b.close()

run()
bad = [n for ok, n in results if not ok]
print(f'\n{len(results) - len(bad)} passed, {len(bad)} failed')
sys.exit(1 if bad else 0)
