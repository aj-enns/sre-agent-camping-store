// With Vite running, execute in the browser console:
// await (await import('/tests/product-page.browser.js')).runProductPageTests()
// All API requests in the isolated test frame use fixtures, never the live cart.
function installFakeApi() {
  const products = [
    { id: 1, name: 'TrailBlazer 2-Person Tent', category: 'Tents', description: 'Lightweight 3-season backpacking tent with a full-coverage rainfly.', price: 189.99, stockQuantity: 3 },
    { id: 12, name: 'TrekPro 65L Backpack', category: 'Packs', description: 'Adjustable-torso expedition pack with rain cover.', price: 249, stockQuantity: 0 },
  ];
  const state = window.__productPageTest = {
    products, cart: { userId: 'demo-user', items: [], total: 0 },
    calls: [], failLoad: false, failAdd: false, holdAdd: false, releaseAdd: null,
    metricsCalls: 0, failMetrics: false,
    metrics: { sessionId: 'fixture-session', status: 'healthy', totalSales: 189.99, orderCount: 1,
      averagePer10Seconds: 30, estimatedLoss: 0, hasLossBaseline: false,
      currentOutage: null, recentOutages: [], lastCheckAt: Date.now() },
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, window.parent.location.href);
    if (url.pathname === '/demo/metrics') {
      state.metricsCalls++;
      return Response.json(state.failMetrics ? { message: 'Unavailable' } : state.metrics, { status: state.failMetrics ? 503 : 200 });
    }
    if (!url.pathname.startsWith('/api/')) return originalFetch(input, options);
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    state.calls.push({ path: url.pathname, method, body });
    const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/api/products/categories') return response(['Tents', 'Packs']);
    if (url.pathname === '/api/products') return response(products.filter((product) =>
      (!url.searchParams.get('category') || product.category === url.searchParams.get('category')) &&
      product.name.toLowerCase().includes((url.searchParams.get('q') ?? '').toLowerCase())));
    if (/\/api\/products\/\d+$/.test(url.pathname)) {
      if (state.failLoad) return response({ message: 'Test service unavailable' }, 503);
      const product = products.find((item) => item.id === Number(url.pathname.split('/').pop()));
      return response(product ?? {}, product ? 200 : 404);
    }
    if (/^\/api\/cart\/shopper-[^/]+$/.test(url.pathname) && method === 'GET') return response(state.cart);
    if (/^\/api\/cart\/shopper-[^/]+\/items$/.test(url.pathname) && method === 'POST') {
      if (state.holdAdd) await new Promise((resolve) => { state.releaseAdd = resolve; });
      if (state.failAdd) return response({ message: 'Test cart unavailable' }, 500);
      const product = products.find((item) => item.id === body.productId);
      const existing = state.cart.items.find((item) => item.productId === product.id);
      if (existing) existing.quantity += body.quantity;
      else state.cart.items.push({ id: product.id, productId: product.id, product, quantity: body.quantity });
      state.cart.total = state.cart.items.reduce((total, item) => total + item.product.price * item.quantity, 0);
      return response(state.cart);
    }
    if (/^\/api\/orders\/user\/shopper-[^/]+$/.test(url.pathname)) return response([]);
    throw new Error(`Unexpected test API request: ${method} ${url.pathname}`);
  };
}

export async function runProductPageTests() {
  const results = [];
  const assert = (condition, name) => {
    if (!condition) throw new Error(`Product page regression: ${name}`);
    results.push(name);
  };
  const waitFor = async (condition, name) => {
    const deadline = Date.now() + 8000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${name}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const html = await (await fetch('/')).text();
  const source = html.replace(/(["'])\//g, `$1${location.origin}/`)
    .replace('<head>', `<head><script>(${installFakeApi.toString()})()<\/script>`);
  const url = URL.createObjectURL(new Blob([source], { type: 'text/html' }));
  const frame = document.createElement('iframe');
  frame.title = 'Isolated product page regression tests';
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;border:0;';
  frame.src = url;
  document.body.append(frame);
  const doc = () => frame.contentDocument;
  const find = (selector) => doc().querySelector(selector);
  const click = (selector) => {
    const target = find(selector);
    if (!target) throw new Error(`Missing test target: ${selector}`);
    target.click();
  };
  const input = (selector, value) => {
    const target = find(selector);
    Object.getOwnPropertyDescriptor(frame.contentWindow.HTMLInputElement.prototype, 'value').set.call(target, value);
    target.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
  };
  const go = async (hash, condition) => {
    frame.contentWindow.location.hash = hash;
    await waitFor(condition, hash);
  };
  const checkPinnedMessage = async (selector, label) => {
    for (const width of [1280, 390, 320]) {
      frame.style.width = `${width}px`;
      frame.style.height = '600px';
      await new Promise((resolve) => setTimeout(resolve, 50));
      frame.contentWindow.scrollTo({ top: doc().documentElement.scrollHeight, behavior: 'instant' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const header = find('.topbar').getBoundingClientRect();
      const message = find(selector).getBoundingClientRect();
      assert(frame.contentWindow.scrollY > 0 && Math.abs(header.top) < 1, `${label}: navigation stays at the viewport top at ${width}px`);
      assert(message.top >= header.bottom - 1 && message.bottom <= 600 && message.height > 0, `${label}: message stays visible below navigation at ${width}px`);
      assert(find('.store-header').contains(doc().elementFromPoint(message.left + 10, message.top + 10)), `${label}: message is above scrolling content at ${width}px`);
      assert(doc().documentElement.scrollWidth <= width, `${label}: no horizontal overflow at ${width}px`);
      const panel = find('.demo-panel').getBoundingClientRect();
      assert(Math.abs(panel.bottom - doc().documentElement.clientHeight) < 1 && panel.height <= 120, `${label}: compact metrics stay at the bottom at ${width}px`);
      assert(Number.parseFloat(frame.contentWindow.getComputedStyle(doc().body).paddingBottom) >= panel.height, `${label}: page reserves room for bottom metrics at ${width}px`);
      assert(Number.parseFloat(frame.contentWindow.getComputedStyle(doc().documentElement).scrollPaddingTop) >= find('.store-header').getBoundingClientRect().height, `${label}: anchor clearance includes the message at ${width}px`);
      find('.demo-history').open = true;
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert(find('.demo-history-body').getBoundingClientRect().top >= message.bottom - 1, `${label}: expanded history does not cover the toast at ${width}px`);
      assert(find('.demo-history-body').getBoundingClientRect().bottom <= panel.top + 1, `${label}: history opens above the bottom bar at ${width}px`);
      find('.demo-history').open = false;
    }
    frame.style.width = '1280px';
    frame.style.height = '900px';
    frame.contentWindow.scrollTo({ top: 0, behavior: 'instant' });
  };

  try {
    await waitFor(() => find('.product-card-link'), 'catalog');
    await waitFor(() => find('.demo-totals')?.textContent.includes('$189.99'), 'shared sales panel');
    assert(find('.demo-totals').textContent.includes('$30.00'), 'Shared panel displays server-provided sales and average');
    assert(!find('.demo-panel button'), 'Presentation panel has no public reset control');
    assert(find('.product-card:last-child .add-button').disabled, 'Catalog quick-add also respects out-of-stock items');
    input('.search-field input', 'TrailBlazer');
    await waitFor(() => find('.search-field input')?.value === 'TrailBlazer' && doc().querySelectorAll('.product-card').length === 1, 'filtered catalog');
    click('.product-card-link');
    await waitFor(() => find('#product-title'), 'product navigation');
    assert(frame.contentWindow.location.hash === '#/products/1', 'Catalog card opens a shareable product URL');
    assert(frame.contentWindow.scrollY === 0, 'Product navigation keeps the store header visible');
    assert(find('#product-title').textContent === 'TrailBlazer 2-Person Tent' && find('.detail-description').textContent.includes('rainfly') && find('.detail-price').textContent.includes('$189.99'), 'Product name, description, and price come from the API');
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map((value) => {
        const channel = Number(value) / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const buttonStyle = frame.contentWindow.getComputedStyle(find('.product-add-button'));
    const colors = [luminance(buttonStyle.color), luminance(buttonStyle.backgroundColor)].sort((a, b) => b - a);
    assert((colors[0] + .05) / (colors[1] + .05) >= 4.5, 'Purchase button text meets 4.5:1 contrast');
    assert(find('.product-add-button').getBoundingClientRect().height >= 52, 'Purchase button retains its large touch target');
    assert(find('[aria-label="Decrease quantity"]').disabled, 'Quantity starts at one and cannot decrease below one');
    for (const value of ['', '0', '-1', '1.5', '4']) {
      input('#product-quantity', value);
      await waitFor(() => find('#quantity-error'), `invalid quantity ${value}`);
      assert(find('.product-add-button').disabled, `Invalid quantity "${value}" cannot be submitted`);
    }
    input('#product-quantity', '3');
    await waitFor(() => find('[aria-label="Increase quantity"]').disabled, 'stock limit');
    assert(!find('.product-add-button').disabled, 'Stock limit is accepted and cannot be incremented');
    input('#product-quantity', '2');
    await waitFor(() => find('.product-line-total').textContent.includes('$379.98'), 'subtotal');
    assert(true, 'Subtotal follows the selected quantity');
    const state = frame.contentWindow.__productPageTest;
    assert(state.calls.some((call) => /\/cart\/shopper-/.test(call.path)), 'Browser uses an isolated anonymous shopper rather than the shared demo-user cart');
    state.holdAdd = true;
    click('.product-add-button');
    await waitFor(() => state.releaseAdd && find('.product-add-button').disabled, 'pending cart request');
    click('.product-add-button');
    assert(state.calls.filter((call) => call.method === 'POST').length === 1, 'Pending submission prevents duplicate cart requests');
    state.holdAdd = false;
    state.releaseAdd();
    await waitFor(() => find('.product-add-status').textContent.includes('2 items added') && find('.cart-count').textContent === '2', 'cart success');
    assert(state.cart.items[0].quantity === 2, 'Selected quantity reaches the API and updates the cart count');
    await checkPinnedMessage('.product-add-status', 'Product success');
    click('.product-add-status a');
    await waitFor(() => find('.cart-item'), 'cart page');
    assert(find('.quantity-control span').textContent === '2', 'View cart displays the selected item quantity');
    await waitFor(() => find('.form-field input')?.value, 'prefilled demo city');
    assert(/, (ON|QC|BC|AB|SK|MB|NS|NB|PE|NL)$/.test(find('.form-field input').value), 'Opening the cart prefills a Canadian city');
    assert(!find('.checkout-button').disabled, 'Prefilled checkout is ready without typing an address');
    const firstPayment = find('.form-field select').value;
    input('.form-field input', 'Ottawa, ON');
    assert(find('.form-field input').value === 'Ottawa, ON', 'Prefilled shipping city remains editable');
    frame.contentWindow.history.back();
    await waitFor(() => find('#product-title'), 'browser Back');
    assert(frame.contentWindow.location.hash === '#/products/1', 'Browser Back restores the product page');
    frame.contentWindow.history.forward();
    await waitFor(() => find('.cart-item'), 'browser Forward');
    assert(frame.contentWindow.location.hash === '#/cart', 'Browser Forward restores the cart');
    await waitFor(() => find('.form-field select')?.value !== firstPayment, 'alternating payment method');
    assert(find('.form-field select').value === (firstPayment === 'card' ? 'paypal' : 'card'), 'Reopening the cart alternates the demo payment method');
    frame.contentWindow.history.back();
    await waitFor(() => find('#product-title'), 'browser Back to details');
    click('.back-link');
    await waitFor(() => find('.search-field input'), 'return to collection');
    assert(find('.search-field input').value === 'TrailBlazer', 'Returning to the collection preserves search');
    click('.clear-search');
    await waitFor(() => doc().querySelectorAll('.product-card').length === 2, 'clear search');
    click('.product-card .add-button');
    await waitFor(() => find('.cart-count').textContent === '3', 'catalog quick-add');
    assert(state.cart.items[0].quantity === 3, 'Catalog quick-add still adds one item');
    assert(find('.product-add-status').textContent.includes('1 item added'), 'Catalog quick-add uses the shared success message');
    await checkPinnedMessage('.product-add-status', 'Catalog success');
    click('.top-nav a[href="#/orders"]');
    await waitFor(() => find('.orders-page .empty-state'), 'order history');
    assert(find('.product-add-status').textContent === '', 'Navigation clears stale success messages');
    assert(find('.orders-page .empty-state').textContent.includes('No orders yet'), 'Order history remains accessible from the shared navigation');
    await go('#/products/1', () => find('#product-title'));
    click('.product-breadcrumbs a:nth-of-type(2)');
    await waitFor(() => find('.category-list .selected')?.textContent.includes('Tents'), 'category breadcrumb');
    assert(find('.search-field input').value === '' && doc().querySelectorAll('.product-card').length === 1, 'Category breadcrumb opens the matching collection');
    await go('#/products/12', () => find('#product-title')?.textContent === 'TrekPro 65L Backpack');
    assert(find('.product-add-button').disabled && !find('#product-quantity') && find('.product-availability').textContent.includes('Out of stock'), 'Out-of-stock items cannot be added');
    await go('#/products/999', () => find('.product-unavailable h1')?.textContent === 'Item not found');
    assert(true, 'Unknown products have a recovery link instead of a broken page');
    const beforeInvalid = state.calls.length;
    await go('#/products/not-an-id', () => find('.product-unavailable h1')?.textContent === 'Item not found');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(state.calls.length === beforeInvalid, 'Malformed product IDs do not issue API requests');
    state.failLoad = true;
    await go('#/products/1', () => find('.product-unavailable [role="alert"]'));
    assert(find('.product-unavailable [role="alert"]').textContent.includes('Test service unavailable'), 'Load failures display the actual API error');
    state.failLoad = false;
    click('.product-unavailable button');
    await waitFor(() => find('#product-title'), 'retry');
    assert(true, 'Retry recovers a failed product load');
    state.failAdd = true;
    click('.product-add-button');
    await waitFor(() => find('.error-banner'), 'cart error');
    assert(!find('.product-add-status').textContent.includes('added') && !find('.product-add-button').disabled, 'Failed cart requests show an error, never a success message, and allow retry');
    await checkPinnedMessage('.error-banner', 'Cart error');
    state.failAdd = false;
    const previousWindow = frame.contentWindow.__productPageTest;
    frame.contentWindow.location.reload();
    await waitFor(() => frame.contentWindow.__productPageTest !== previousWindow && find('#product-title'), 'direct product reload');
    assert(find('#product-title').textContent === 'TrailBlazer 2-Person Tent', 'Reloading a product URL restores product details');
    frame.style.width = '390px';
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    assert(doc().documentElement.scrollWidth <= 390 && frame.contentWindow.getComputedStyle(find('.product-page-layout')).gridTemplateColumns.split(' ').length === 1, 'Mobile product page stacks without horizontal overflow');
    const updatedState = frame.contentWindow.__productPageTest;
    updatedState.metrics.totalSales = 400;
    const polls = updatedState.metricsCalls;
    await waitFor(() => updatedState.metricsCalls > polls && find('.demo-totals').textContent.includes('$400.00'), 'five-second metrics refresh');
    assert(true, 'Panel refreshes actual server totals without reloading the page');
    updatedState.failMetrics = true;
    await waitFor(() => find('.demo-caption').textContent.includes('unavailable'), 'metrics failure');
    assert(find('.demo-caption').textContent.includes('Last received'), 'Failed metrics requests explicitly label stale values');
    updatedState.failMetrics = false;
    await waitFor(() => find('.demo-caption').textContent.includes('Cart available'), 'metrics recovery');
    assert(true, 'Polling recovers after failure without a page reload');
    return { passed: results.length, results };
  } finally {
    frame.remove();
    URL.revokeObjectURL(url);
  }
}
