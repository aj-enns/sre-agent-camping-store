import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './api';
import { money, productArt } from './catalog';
import ProductPage from './ProductPage';
import DemoPanel from './DemoPanel';
import type { Cart, Order, Product } from './types';

function shopperId() {
  const key = 'trailhead-shopper';
  const existing = localStorage.getItem(key);
  if (existing?.startsWith('shopper-')) return existing;
  const id = `shopper-${crypto.randomUUID()}`;
  localStorage.setItem(key, id);
  return id;
}
const USER_ID = shopperId();
const DEMO_CITIES = [
  'Toronto, ON', 'Ottawa, ON', 'Hamilton, ON', 'London, ON', 'Kingston, ON',
  'Windsor, ON', 'Kitchener, ON', 'Sudbury, ON', 'Thunder Bay, ON', 'Montreal, QC',
  'Quebec City, QC', 'Gatineau, QC', 'Sherbrooke, QC', 'Trois-Rivieres, QC', 'Vancouver, BC',
  'Victoria, BC', 'Kelowna, BC', 'Kamloops, BC', 'Calgary, AB', 'Edmonton, AB',
  'Red Deer, AB', 'Saskatoon, SK', 'Regina, SK', 'Winnipeg, MB', 'Brandon, MB',
  'Halifax, NS', 'Moncton, NB', 'Fredericton, NB', 'Charlottetown, PE', "St. John's, NL",
];
type View = 'shop' | 'cart' | 'orders';
type Route = { view: View } | { view: 'product'; productId: number | null };
type Runner = <T>(action: () => Promise<T>) => Promise<T | undefined>;
type AddToCart = (productId: number, quantity?: number) => Promise<boolean>;
type Filters = { category: string; query: string };

function readRoute(): Route {
  const hash = window.location.hash;
  if (hash.startsWith('#/products/')) {
    const id = Number(hash.slice('#/products/'.length));
    return { view: 'product', productId: /^[1-9]\d*$/.test(hash.slice('#/products/'.length)) && Number.isSafeInteger(id) && id <= 2147483647 ? id : null };
  }
  if (hash === '#/cart') return { view: 'cart' };
  if (hash === '#/orders') return { view: 'orders' };
  return { view: 'shop' };
}

function BrandMark() {
  return (
    <svg viewBox="0 0 42 34" aria-hidden="true">
      <path d="M2 29 15 7l7 11 5-8 13 19H2Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="m9 29 6-10 5 7 6-9 10 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 8h15l1 12h-17l1-12Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

export default function App() {
  const api = useApi();
  const [route, setRoute] = useState<Route>(readRoute);
  const view = route.view;
  const [filters, setFilters] = useState<Filters>({ category: '', query: '' });
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addedQuantity, setAddedQuantity] = useState(0);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const updateHeight = () => {
      document.documentElement.style.setProperty('--store-header-height', `${header.getBoundingClientRect().height}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--store-header-height');
    };
  }, []);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      setError(null);
      setAddedQuantity(0);
      return await action();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    }
  }, []);

  const refreshCart = useCallback(async () => {
    const nextCart = await run(() => api.getCart(USER_ID));
    if (nextCart) setCart(nextCart);
  }, [api, run]);

  useEffect(() => {
    refreshCart();
  }, [refreshCart]);

  useEffect(() => {
    const navigate = () => {
      setRoute(readRoute());
      setError(null);
      setAddedQuantity(0);
      requestAnimationFrame(() => {
        const catalog = window.location.hash === '#catalog' ? document.getElementById('catalog') : null;
        const target = catalog ?? document.querySelector<HTMLElement>('main');
        target?.focus({ preventScroll: true });
        if (catalog) catalog.scrollIntoView({ block: 'start' });
        else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      });
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  useEffect(() => {
    const title = view === 'cart' ? 'Your cart' : view === 'orders' ? 'Your orders' : view === 'product' ? 'Product details' : 'Camping Supplies';
    document.title = `${title} | Trailhead Outfitters`;
  }, [view]);

  const addToCart: AddToCart = async (productId, quantity = 1) => {
    const nextCart = await run(() => api.addToCart(USER_ID, productId, quantity));
    if (!nextCart) return false;
    setCart(nextCart);
    setAddedQuantity(quantity);
    return true;
  };

  const cartCount = cart?.items.reduce((count, item) => count + item.quantity, 0) ?? 0;

  return (
    <>
      <div className="store-header" ref={headerRef}>
        <header className="topbar">
          <a className="brand" href="#/" aria-label="Trailhead Outfitters home">
            <span className="brand-mark"><BrandMark /></span>
            <span className="brand-name">Trailhead <span>Outfitters</span></span>
          </a>
          <nav className="top-nav" aria-label="Main navigation">
            <a className={view === 'shop' || view === 'product' ? 'nav-link active' : 'nav-link'} href="#/" aria-current={view === 'shop' ? 'page' : undefined}>Gear</a>
            <a className={view === 'cart' ? 'nav-link active' : 'nav-link'} href="#/cart" aria-current={view === 'cart' ? 'page' : undefined}>
              <BagIcon /> Cart <span className="cart-count">{cartCount}</span>
            </a>
            <a className={view === 'orders' ? 'nav-link active' : 'nav-link'} href="#/orders" aria-current={view === 'orders' ? 'page' : undefined}>Orders</a>
          </nav>
        </header>

        <DemoPanel />
        {error && <div className="error-banner" role="alert">{error}</div>}
        <div className="product-add-status" role="status" aria-live="polite">
          {addedQuantity > 0 && <><span>{addedQuantity} {addedQuantity === 1 ? 'item' : 'items'} added to your cart.</span> <a href="#/cart">View cart &rarr;</a></>}
        </div>
      </div>

      <main className={`page page-${view}`} tabIndex={-1}>
        {view === 'shop' && <Shop run={run} onAdd={addToCart} filters={filters} onFiltersChange={setFilters} />}
        {route.view === 'product' && <ProductPage key={route.productId ?? 'missing'} productId={route.productId} onAdd={addToCart} onCategorySelect={(category) => setFilters({ category, query: '' })} />}
        {view === 'cart' && <CartView cart={cart} run={run} onCartChange={setCart} onBrowse={() => { window.location.hash = '#/'; }} onOrdered={() => { window.location.hash = '#/orders'; }} />}
        {view === 'orders' && <Orders run={run} />}
      </main>

      <footer className="site-footer">
        <span>Trailhead Outfitters</span>
        <span>Sample catalog · Product photography is illustrative</span>
      </footer>
    </>
  );
}

function Shop({ run, onAdd, filters, onFiltersChange }: {
  run: Runner;
  onAdd: AddToCart;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}) {
  const api = useApi();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const { category, query } = filters;
  const setCategory = (category: string) => onFiltersChange({ ...filters, category });
  const setQuery = (query: string) => onFiltersChange({ ...filters, query });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    run(() => api.getCategories()).then((result) => result && setCategories(result));
  }, [api, run]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    run(() => api.getProducts(category, query)).then((result) => {
      if (active && result) setProducts(result);
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [api, category, query, run]);

  return (
    <div className="shop-layout">
      <aside className="category-rail">
        <h1>Find your gear.</h1>
        <p className="rail-description">Good days outside start with the right kit.</p>
        <nav className="category-list" aria-label="Shop by category">
          <button className={category === '' ? 'category-link selected' : 'category-link'} type="button" onClick={() => setCategory('')} aria-pressed={category === ''}>
            <span>All gear</span><span className="category-arrow">↗</span>
          </button>
          {categories.map((item) => (
            <button key={item} className={category === item ? 'category-link selected' : 'category-link'} type="button" onClick={() => setCategory(item)} aria-pressed={category === item}>
              <span>{item}</span><span className="category-arrow">↗</span>
            </button>
          ))}
        </nav>
        <div className="rail-note">
          <span className="rail-note-mark"><BrandMark /></span>
          <p>Take only what you need.<br />Make room for the unexpected.</p>
        </div>
      </aside>

      <section className="storefront" aria-label="Camping gear catalog">
        <section className="feature-panel" aria-labelledby="feature-title">
          <img className="feature-image" src="/images/camping-forest-hero.webp" alt="View from an orange tent toward a stone fire ring and forest campsite" />
          <div className="feature-overlay" />
          <div className="feature-copy">
            <h2 id="feature-title">Make room<br />for outside.</h2>
            <p>Camping essentials for wherever the trail takes you.</p>
            <a className="feature-action" href="#catalog">Explore the gear <span aria-hidden="true">↘</span></a>
          </div>
          <span className="feature-caption">Trailhead Outfitters <span>—</span> Camping collection</span>
        </section>

        <section className="catalog" id="catalog" aria-labelledby="catalog-title" tabIndex={-1}>
          <div className="catalog-heading">
            <div>
              <h2 id="catalog-title">{category || 'Pack for the outdoors'}</h2>
              <p>Explore the collection and find your next favorite.</p>
            </div>
            <label className="search-field">
              <SearchIcon />
              <span className="visually-hidden">Search camping gear</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search gear" />
              {query && <button type="button" className="clear-search" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
            </label>
          </div>

          <div className="catalog-meta" aria-live="polite">
            <span>{loading ? 'Finding gear…' : `${products.length} ${products.length === 1 ? 'item' : 'items'}`}</span>
            <span>Prices shown in USD</span>
          </div>

          {loading ? (
            <div className="loading-state" role="status">Loading the collection…</div>
          ) : products.length > 0 ? (
            <div className="product-grid">
              {products.map((product) => <ProductCard key={product.id} product={product} onAdd={onAdd} />)}
            </div>
          ) : (
            <div className="empty-state">
              <h3>No gear found</h3>
              <p>Try a different search or choose another category.</p>
              <button className="text-button" type="button" onClick={() => onFiltersChange({ query: '', category: '' })}>Show all gear <span aria-hidden="true">↗</span></button>
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function ProductCard({ product, onAdd }: { product: Product; onAdd: AddToCart }) {
  const art = productArt(product);
  const [adding, setAdding] = useState(false);
  const add = async () => {
    setAdding(true);
    await onAdd(product.id);
    setAdding(false);
  };
  return (
    <article className="product-card">
      <a className="product-card-link" href={`#/products/${product.id}`} aria-label={`View ${product.name}`}>
        <div className="product-image-wrap">
          <img src={art.src} alt={art.alt} loading="lazy" />
          <span className="product-category">{product.category}</span>
        </div>
        <div className="product-details">
          <div className="product-heading">
            <h3>{product.name}</h3>
            <span className="product-price">{money(product.price)}</span>
          </div>
          <p className="product-description">{product.description}</p>
        </div>
      </a>
      <div className="product-card-actions">
        <button className="add-button" type="button" disabled={adding || product.stockQuantity < 1} onClick={add} aria-label={product.stockQuantity < 1 ? `${product.name} is out of stock` : `Add ${product.name} to cart`}>
          {adding ? 'Adding...' : product.stockQuantity < 1 ? 'Out of stock' : 'Add to cart'} <span aria-hidden="true">+</span>
        </button>
      </div>
    </article>
  );
}

function CartView({ cart, run, onCartChange, onBrowse, onOrdered }: {
  cart: Cart | null;
  run: Runner;
  onCartChange: (cart: Cart) => void;
  onBrowse: () => void;
  onOrdered: () => void;
}) {
  const api = useApi();
  const [address, setAddress] = useState('');
  const [payment, setPayment] = useState('card');
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  const defaultsApplied = useRef(false);

  useEffect(() => {
    if (defaultsApplied.current) return;
    defaultsApplied.current = true;
    setAddress(DEMO_CITIES[Math.floor(Math.random() * DEMO_CITIES.length)]);
    const nextPayment = sessionStorage.getItem('trailhead-last-payment') === 'card' ? 'paypal' : 'card';
    setPayment(nextPayment);
    sessionStorage.setItem('trailhead-last-payment', nextPayment);
  }, []);

  const update = async (id: number, quantity: number) => {
    const nextCart = await run(() => quantity < 1
      ? api.removeCartItem(USER_ID, id)
      : api.updateCartItem(USER_ID, id, quantity));
    if (nextCart) onCartChange(nextCart);
  };

  const checkout = async () => {
    if (placingRef.current) return;
    placingRef.current = true;
    setPlacing(true);
    const order = await run(() => api.placeOrder(USER_ID, address, payment));
    placingRef.current = false;
    setPlacing(false);
    if (!order) return;
    const nextCart = await run(() => api.getCart(USER_ID));
    if (nextCart) onCartChange(nextCart);
    onOrdered();
  };

  if (!cart || cart.items.length === 0) {
    return (
      <section className="page-content empty-cart">
        <p className="section-label">Your cart</p>
        <h1>Your next trip starts here.</h1>
        <p>Your cart is empty. Browse the collection to find your gear.</p>
        <button className="primary-button" type="button" onClick={onBrowse}>Shop the collection <span aria-hidden="true">↗</span></button>
      </section>
    );
  }

  return (
    <section className="page-content checkout-page">
      <div className="page-heading">
        <div><p className="section-label">Your cart</p><h1>Ready when you are.</h1></div>
        <span className="catalog-meta">{cart.items.reduce((count, item) => count + item.quantity, 0)} items</span>
      </div>
      <div className="checkout-layout">
        <div className="cart-items">
          {cart.items.map((item) => {
            const art = productArt(item.product);
            return (
              <article className="cart-item" key={item.id}>
                <img src={art.src} alt="" loading="lazy" />
                <div className="cart-item-info">
                  <p className="product-category">{item.product.category}</p>
                  <h2>{item.product.name}</h2>
                  <span>{money(item.product.price)}</span>
                </div>
                <div className="quantity-control" aria-label={`Quantity for ${item.product.name}`}>
                  <button type="button" onClick={() => update(item.id, item.quantity - 1)} aria-label={`Remove one ${item.product.name}`}>−</button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => update(item.id, item.quantity + 1)} aria-label={`Add one ${item.product.name}`}>+</button>
                </div>
              </article>
            );
          })}
        </div>
        <aside className="order-panel">
          <h2>Order details</h2>
          <div className="total-line"><span>Subtotal</span><strong>{money(cart.total)}</strong></div>
          <p className="demo-note">Demo checkout only. No real payment is processed.</p>
          <label className="form-field">Shipping address (demo)
            <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Canadian city" />
          </label>
          <label className="form-field">Payment method
            <select value={payment} onChange={(event) => setPayment(event.target.value)}>
              <option value="card">Credit card (demo)</option>
              <option value="paypal">PayPal (demo)</option>
            </select>
          </label>
          <button className="primary-button checkout-button" type="button" disabled={placing || !address.trim()} onClick={checkout}>{placing ? 'Placing order...' : 'Place demo order'} <span aria-hidden="true">↗</span></button>
        </aside>
      </div>
    </section>
  );
}

function Orders({ run }: { run: Runner }) {
  const api = useApi();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    run(() => api.getOrders(USER_ID)).then((result) => {
      if (active && result) setOrders(result);
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [api, run]);

  return (
    <section className="page-content orders-page">
      <div className="page-heading"><div><p className="section-label">Order history</p><h1>Your orders.</h1></div></div>
      {loading ? <div className="loading-state" role="status">Loading your orders…</div> : orders.length === 0 ? (
        <div className="empty-state"><h2>No orders yet</h2><p>Your demo orders will appear here.</p></div>
      ) : (
        <div className="orders-list">
          {orders.map((order) => (
            <article className="order-card" key={`${order.orderDate}-${order.id}`}>
              <div className="order-card-heading">
                <div><span className="product-category">Order #{order.id}</span><h2>{new Date(order.orderDate).toLocaleDateString()}</h2></div>
                <span className="order-status">{order.status}</span>
              </div>
              <ul>{order.items.map((item) => <li key={item.id}><span>{item.quantity} × {item.product.name}</span><strong>{money(item.product.price * item.quantity)}</strong></li>)}</ul>
              <div className="total-line"><span>Total</span><strong>{money(order.total)}</strong></div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
