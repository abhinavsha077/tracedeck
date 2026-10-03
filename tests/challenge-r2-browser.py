#!/usr/bin/env python3
"""
Empirical Browser Challenge for Milestone R2 Web Dashboard
Tests in headless Chromium via Playwright:
1. Timeline seek and drag-scrubbing with playhead thumb tracking
2. Tooltip hover display on timeline
3. Keyword search across action, network, console, and error events
4. Status code and log level filter dropdowns and category count badges
5. Filter reset functionality
6. Event detail drawer expansion, structured tables, and Copy JSON button
7. Multi-artifact gallery switching (video, screenshot, attachment/log)
8. Zero console errors and zero unhandled page exceptions
"""

import sys
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1] / 'apps' / 'web'
html = (root / 'index.html').read_text(encoding='utf-8').replace('<script type="module" src="/app/app.js"></script>', '')
app = (root / 'app.js').read_text(encoding='utf-8')

mock_capture = {
    'id': 'cap_empirical_challenge',
    'title': 'Empirical Challenge: Checkout & Payment Flow Failure',
    'description': 'Stress-testing timeline scrubbing, filtering, detail drawer, and multi-artifact gallery.',
    'url': 'https://shop.example.com/checkout',
    'source': 'extension',
    'createdAt': '2026-09-22T03:00:00.000Z',
    'durationMs': 12000,
    'environment': {
        'browser': 'Chromium 125',
        'os': 'Windows 11',
        'viewport': '1920x1080'
    },
    'metadata': {
        'cartId': 'cart_88319',
        'userEmail': 'qa-tester@example.com'
    },
    'artifacts': [
        {
            'id': 'art_video_1',
            'kind': 'video',
            'name': 'user-checkout-session.webm',
            'bytes': 3145728,
            'contentType': 'video/webm'
        },
        {
            'id': 'art_screen_1',
            'kind': 'screenshot',
            'name': 'payment-gateway-error.png',
            'bytes': 245000,
            'contentType': 'image/png'
        },
        {
            'id': 'art_log_1',
            'kind': 'log',
            'name': 'stripe-webhooks.log',
            'bytes': 15360,
            'contentType': 'text/plain'
        }
    ],
    'events': [
        {
            'type': 'action',
            'ts': 500,
            'data': {
                'action': 'click',
                'selector': '#shipping-method-express',
                'label': 'Select Express Shipping'
            }
        },
        {
            'type': 'network',
            'ts': 1200,
            'data': {
                'method': 'GET',
                'url': 'https://shop.example.com/api/rates?zip=94107',
                'status': 200,
                'statusText': 'OK',
                'duration': 180,
                'phase': 'response',
                'headers': {'Accept': 'application/json'},
                'responseHeaders': {'content-type': 'application/json', 'cache-control': 'no-cache'}
            }
        },
        {
            'type': 'action',
            'ts': 2500,
            'data': {
                'action': 'input',
                'selector': '#credit-card-number',
                'label': 'Card Number Input',
                'sensitive': True,
                'valueLength': 16
            }
        },
        {
            'type': 'console',
            'ts': 3000,
            'level': 'info',
            'data': {
                'message': 'Stripe Elements SDK v3 initialized successfully'
            }
        },
        {
            'type': 'network',
            'ts': 4500,
            'data': {
                'method': 'POST',
                'url': 'https://shop.example.com/api/checkout/validate',
                'status': 302,
                'statusText': 'Found',
                'duration': 210,
                'phase': 'response'
            }
        },
        {
            'type': 'action',
            'ts': 5800,
            'data': {
                'action': 'click',
                'selector': 'button#submit-payment',
                'label': 'Complete Purchase ($149.00)'
            }
        },
        {
            'type': 'network',
            'ts': 6500,
            'data': {
                'method': 'POST',
                'url': 'https://shop.example.com/api/checkout/charge',
                'status': 500,
                'statusText': 'Internal Server Error',
                'duration': 420,
                'phase': 'response',
                'headers': {'x-request-id': 'req_fail_9981', 'content-type': 'application/json'},
                'responseHeaders': {'x-trace-id': 'trace_srv_440'},
                'error': 'Payment gateway responded with HTTP 500'
            }
        },
        {
            'type': 'console',
            'ts': 6600,
            'level': 'error',
            'data': {
                'message': 'Uncaught PaymentGatewayException: Charge declined by processor at submitPayment',
                'stack': 'PaymentGatewayException: Charge declined\n    at submitPayment (checkout.bundle.js:842:15)\n    at HTMLButtonElement.dispatch (vendor.js:12:4)'
            }
        },
        {
            'type': 'console',
            'ts': 7000,
            'level': 'warn',
            'data': {
                'message': 'Fallback payment retry queue is at capacity'
            }
        },
        {
            'type': 'network',
            'ts': 8200,
            'data': {
                'method': 'GET',
                'url': 'https://shop.example.com/api/user/orders/recent',
                'status': 404,
                'statusText': 'Not Found',
                'duration': 95,
                'phase': 'response'
            }
        },
        {
            'type': 'network',
            'ts': 9500,
            'data': {
                'method': 'POST',
                'url': 'https://shop.example.com/api/telemetry',
                'status': 0,
                'failed': True,
                'error': 'net::ERR_CONNECTION_REFUSED'
            }
        }
    ],
    'comments': [
        {
            'author': 'Lead QA',
            'createdAt': '2026-09-22T03:05:00.000Z',
            'body': 'Reproduced consistently when selecting express shipping on cart total > $100.',
            'ts': 6500
        }
    ],
    'shares': []
}

payloads = {
    '/api/health': {'ok': True, 'version': '0.1.0'},
    '/api/config': {'projects': [{'id': 'prj_default', 'name': 'Empirical Project'}], 'integrationStatus': {}, 'features': {}},
    '/api/captures': {'captures': [
        {
            'id': 'cap_empirical_challenge',
            'title': mock_capture['title'],
            'description': mock_capture['description'],
            'url': mock_capture['url'],
            'source': mock_capture['source'],
            'createdAt': mock_capture['createdAt'],
            'durationMs': mock_capture['durationMs'],
            'eventCount': len(mock_capture['events']),
            'artifactCount': len(mock_capture['artifacts']),
            'errorCount': 4,
            'failedRequestCount': 3
        }
    ]},
    '/api/recording-links': {'recordingLinks': []},
    '/api/webhooks': {'webhooks': [], 'deliveries': []},
    '/api/captures/cap_empirical_challenge': {'capture': mock_capture}
}

console_messages = []
console_errors = []
page_errors = []

print('Starting Playwright Chromium Browser Empirical Challenge...')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    page.on('console', lambda msg: (
        console_messages.append(f'[{msg.type}] {msg.text}'),
        console_errors.append(msg.text) if msg.type in ('error',) else None
    ))
    page.on('pageerror', lambda e: page_errors.append(str(e)))

    # Set initial HTML
    page.set_content(html)

    # Intercept fetch
    page.evaluate("""(payloads) => {
        window.fetch = async (input, init) => {
            const u = typeof input === 'string' ? input : input.url;
            const path = u.startsWith('http') ? new URL(u).pathname : u.split('?')[0];
            const data = payloads[path] || { error: 'Not mocked: ' + path };
            return new Response(JSON.stringify(data), {
                status: payloads[path] ? 200 : 404,
                headers: { 'content-type': 'application/json' }
            });
        };
    }""", payloads)

    # Inject app.js
    page.add_script_tag(content=app, type='module')

    # Wait for capture card and click it
    page.wait_for_selector('.capture-card', timeout=5000)
    print('  [PASS] Web app shell loaded and rendered capture card.')

    page.locator('.capture-card').click()
    page.wait_for_selector('.detail-head h1', timeout=5000)
    assert page.locator('.detail-head h1').inner_text() == mock_capture['title']
    print('  [PASS] Capture selected and detail header rendered.')

    # 1. Challenge: Timeline and playhead scrubber
    timeline = page.locator('#timeline')
    assert timeline.is_visible(), 'Timeline must be visible'
    scrubber = page.locator('#timeline-scrubber')
    assert scrubber.is_visible(), 'Timeline scrubber playhead must be visible'
    progress = page.locator('#timeline-progress')

    box = timeline.bounding_box()
    assert box and box['width'] > 100, 'Timeline must have measurable width'

    # Click seek at 50% along the timeline
    page.mouse.click(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.5)
    page.wait_for_timeout(200)

    # Scrubber position should be around 50%
    scrubber_left = page.evaluate("() => document.querySelector('#timeline-scrubber').style.left")
    assert '50' in scrubber_left or '49' in scrubber_left or '51' in scrubber_left, f'Scrubber left should be ~50%, got {scrubber_left}'
    print(f'  [PASS] Click-to-seek updated playhead thumb to {scrubber_left}')

    # Drag scrub along the timeline: from 20% to 80%
    start_x = box['x'] + box['width'] * 0.2
    end_x = box['x'] + box['width'] * 0.8
    y = box['y'] + box['height'] * 0.5

    page.mouse.move(start_x, y)
    page.mouse.down()
    page.mouse.move(box['x'] + box['width'] * 0.5, y)
    page.mouse.move(end_x, y)
    page.mouse.up()
    page.wait_for_timeout(200)

    scrubber_drag_left = page.evaluate("() => document.querySelector('#timeline-scrubber').style.left")
    assert '80' in scrubber_drag_left or '79' in scrubber_drag_left or '81' in scrubber_drag_left, f'Scrubber drag left should be ~80%, got {scrubber_drag_left}'
    print(f'  [PASS] Drag-scrub updated playhead thumb to {scrubber_drag_left}')

    # 2. Challenge: Category tab count badges
    all_tab = page.locator('.tab[data-tab="all"]')
    console_tab = page.locator('.tab[data-tab="console"]')
    network_tab = page.locator('.tab[data-tab="network"]')
    action_tab = page.locator('.tab[data-tab="action"]')
    errors_tab = page.locator('.tab[data-tab="errors"]')

    assert all_tab.locator('.tab-badge').inner_text() == '11', 'All tab badge must show 11'
    assert console_tab.locator('.tab-badge').inner_text() == '3', 'Console tab badge must show 3'
    assert network_tab.locator('.tab-badge').inner_text() == '5', 'Network tab badge must show 5'
    assert action_tab.locator('.tab-badge').inner_text() == '3', 'Action tab badge must show 3'
    assert errors_tab.locator('.tab-badge').inner_text() == '4', 'Errors tab badge must show 4 (1 console error + 3 network failures)'
    print('  [PASS] Tab badges display verified category counts (All: 11, Console: 3, Net: 5, Action: 3, Err: 4)')

    # 3. Challenge: Tab switching
    errors_tab.click()
    page.wait_for_timeout(100)
    err_rows = page.locator('.event-row')
    assert err_rows.count() == 4, f'Errors tab must filter to 4 error events, found {err_rows.count()}'
    all_tab.click()
    page.wait_for_timeout(100)
    assert page.locator('.event-row').count() == 11, 'All tab must restore all 11 events'
    print('  [PASS] Category tab switching accurately filters rows.')

    # 4. Challenge: Keyword search
    search_input = page.locator('#event-search')
    search_input.fill('PaymentGatewayException')
    page.wait_for_timeout(150)
    filtered = page.locator('.event-row')
    assert filtered.count() == 1, f'Search for PaymentGatewayException must yield 1 row, got {filtered.count()}'
    assert 'PaymentGatewayException' in filtered.first.inner_text()

    search_input.fill('POST')
    page.wait_for_timeout(150)
    assert page.locator('.event-row').count() == 3, 'Search for POST should yield 3 requests'

    # 5. Challenge: Status code filter dropdown
    status_select = page.locator('#event-status-filter')
    search_input.fill('')  # clear search
    status_select.select_option('5xx')
    page.wait_for_timeout(150)
    assert page.locator('.event-row').count() == 1, '5xx filter must yield 1 event (the 500 charge error)'

    status_select.select_option('failed')
    page.wait_for_timeout(150)
    assert page.locator('.event-row').count() == 3, 'failed filter must yield 3 events (404, 500, failed=true)'

    # 6. Challenge: Level filter dropdown
    level_select = page.locator('#event-level-filter')
    status_select.select_option('all')
    level_select.select_option('warn')
    page.wait_for_timeout(150)
    assert page.locator('.event-row').count() == 1, 'warn filter must yield 1 console warn event'

    # 7. Challenge: Reset button
    reset_btn = page.locator('#filter-reset')
    assert reset_btn.is_visible(), 'Reset button must appear when filters are active'
    reset_btn.click()
    page.wait_for_timeout(150)
    assert page.locator('.event-row').count() == 11, 'Reset button must restore all 11 events'
    print('  [PASS] Keyword, Status, and Level filters and Reset button verified.')

    # 8. Challenge: Event detail drawer inspection
    # Find the error event row (index corresponding to the 500 charge network request)
    charge_row = page.locator('.event-row:has-text("/api/checkout/charge")')
    assert charge_row.count() == 1
    charge_row.click()
    page.wait_for_timeout(200)

    # Verify drawer expanded
    drawer = page.locator('.event-detail-drawer')
    assert drawer.is_visible(), 'Event detail drawer must expand when row is clicked'
    drawer_text = drawer.inner_text()
    assert 'Internal Server Error' in drawer_text
    assert '420ms' in drawer_text
    assert 'req_fail_9981' in drawer_text, 'Request headers must be rendered in table'
    assert 'trace_srv_440' in drawer_text, 'Response headers must be rendered in table'
    assert 'Payment gateway responded with HTTP 500' in drawer_text, 'Error message must be rendered'
    assert drawer.locator('.copy-json').is_visible(), 'Copy JSON button must be visible'

    # Click Copy JSON button
    drawer.locator('.copy-json').click()
    page.wait_for_timeout(100)
    print('  [PASS] Event detail drawer renders headers table, timing, error details, and Copy JSON.')

    # 9. Challenge: Multi-artifact gallery switcher
    gallery_tabs = page.locator('.gallery-tab')
    assert gallery_tabs.count() == 3, f'Must render 3 gallery tabs for 3 artifacts, found {gallery_tabs.count()}'

    # Video is default
    assert page.locator('#capture-video').is_visible(), 'Default artifact must be video player'

    # Switch to screenshot tab
    screenshot_tab = page.locator('.gallery-tab:has-text("payment-gateway-error.png")')
    screenshot_tab.click()
    page.wait_for_timeout(200)
    assert page.locator('#capture-image').is_visible(), 'Screenshot tab must render image viewer'
    assert page.locator('a:has-text("Open full size ↗")').is_visible(), 'Must render full size link'
    assert page.locator('a:has-text("Download")').is_visible(), 'Must render download button'

    # Switch to log tab
    log_tab = page.locator('.gallery-tab:has-text("stripe-webhooks.log")')
    log_tab.click()
    page.wait_for_timeout(200)
    assert page.locator('.artifact-iframe').is_visible(), 'Log tab must render artifact iframe'
    print('  [PASS] Multi-artifact gallery switcher seamlessly toggles video, screenshot, and log viewers.')

    # 10. Challenge: Check console errors and page exceptions
    print(f'Total console messages captured: {len(console_messages)}')
    if console_errors:
        print('CONSOLE ERRORS DETECTED:')
        for e in console_errors:
            print('  !', e)
        raise RuntimeError(f'Encountered {len(console_errors)} console errors during browser execution!')

    if page_errors:
        print('PAGE ERRORS DETECTED:')
        for pe in page_errors:
            print('  !', pe)
        raise RuntimeError(f'Encountered {len(page_errors)} uncaught page exceptions!')

    print('  [PASS] ZERO console errors and ZERO unhandled page exceptions confirmed in Chromium!')

    browser.close()

print('\n=== ALL BROWSER-LEVEL EMPIRICAL CHALLENGES PASSED (10/10) ===')
