import { useCallback, useEffect, useState } from 'react';
import { useApi } from './api';
import type { Cart, Order, Product } from './types';

const USER_ID = 'demo-user';
const CATEGORY_ART: Record<string, { src: string; alt: string }> = {
  Tents: { src: '/images/tents.jpg', alt: 'Tents at a mountain campsite' },
  'Sleeping Bags': { src: '/images/sleeping-bags.jpg', alt: 'A camper resting in a sleeping bag' },
  'Stoves & Cookware': { src: '/images/stoves-cookware.jpg', alt: 'A camp stove being used outdoors' },
  Lighting: { src: '/images/lighting.jpg', alt: 'A lantern glowing at a campsite' },
  Packs: { src: '/images/packs.jpg', alt: 'Hikers wearing packs in the mountains' },
  Hydration: { src: '/images/hydration.jpg', alt: 'A hiker taking a water break' },
};
const PRODUCT_ART: Record<number, { src: string; alt: string }> = {
  1: { src: '/images/tents.jpg', alt: 'Backpacking tents at a mountain campsite' },
  2: { src: '/images/tents-field.jpg', alt: 'Family tents pitched in an open campsite' },
  3: { src: '/images/campsite-hero.jpg', alt: 'A tent at sunset beneath a mountain ridge' },
  4: { src: '/images/sleeping-bags.jpg', alt: 'A camper resting in a sleeping bag' },
  5: { src: '/images/sleeping-bag-tent.jpg', alt: 'Sleeping bags arranged inside a tent' },
  6: { src: '/images/sleeping-bag-waterfall.jpg', alt: 'Camping sleep gear set up outdoors' },
  7: { src: '/images/stove-backpacking.jpg', alt: 'A pot being used on a compact camp stove' },
  8: { src: '/images/stoves-cookware.jpg', alt: 'A two-burner camp stove at a campsite' },
  9: { src: '/images/stove-cookset.jpg', alt: 'Metal cookware prepared for an outdoor meal' },
  10: { src: '/images/headlamp.jpg', alt: 'A hiker following a mountain trail at night' },
  11: { src: '/images/lantern-camp.jpg', alt: 'A lantern illuminating a campsite table' },
  12: { src: '/images/tents-alpine.jpg', alt: 'Winter hikers crossing an alpine slope' },
  13: { src: '/images/packs-trail.jpg', alt: 'A hiker carrying a daypack on a trail' },
  14: { src: '/images/hydration.jpg', alt: 'A hiker drinking from a water bottle' },
  15: { src: '/images/hydration-trail.jpg', alt: 'A hiker pausing for water on the trail' },
};

function productArt(product: Product) {
  return PRODUCT_ART[product.id] ?? CATEGORY_ART[product.category] ?? CATEGORY_ART.Tents;
}

const money = (amount: number) => `$${amount.toFixed(2)}`;
type View = 'shop' | 'cart' | 'orders';
type Runner = <T>(action: () => Promise<T>) => Promise<T | undefined>;

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
  const [view, setView] = useState<View>('shop');
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      setError(null);
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

  const cartCount = cart?.items.reduce((count, item) => count + item.quantity, 0) ?? 0;

  return (
    <>
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setView('shop')} aria-label="Trailhead Outfitters home">
          <span className="brand-mark"><BrandMark /></span>
          <span className="brand-name">Trailhead <span>Outfitters</span></span>
        </button>
        <nav className="top-nav" aria-label="Main navigation">
          <button className={view === 'shop' ? 'nav-link active' : 'nav-link'} type="button" onClick={() => setView('shop')} aria-current={view === 'shop' ? 'page' : undefined}>Gear</button>
          <button className={view === 'cart' ? 'nav-link active' : 'nav-link'} type="button" onClick={() => setView('cart')} aria-current={view === 'cart' ? 'page' : undefined}>
            <BagIcon /> Cart <span className="cart-count">{cartCount}</span>
          </button>
          <button className={view === 'orders' ? 'nav-link active' : 'nav-link'} type="button" onClick={() => setView('orders')} aria-current={view === 'orders' ? 'page' : undefined}>Orders</button>
        </nav>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <main className={`page page-${view}`}>
        {view === 'shop' && <Shop run={run} onCartChange={setCart} />}
        {view === 'cart' && <CartView cart={cart} run={run} onCartChange={setCart} onBrowse={() => setView('shop')} onOrdered={() => setView('orders')} />}
        {view === 'orders' && <Orders run={run} />}
      </main>

      <footer className="site-footer">
        <span>Trailhead Outfitters</span>
        <span>Sample catalog · Product photography is illustrative</span>
      </footer>
    </>
  );
}

function Shop({ run, onCartChange }: { run: Runner; onCartChange: (cart: Cart) => void }) {
  const api = useApi();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
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

  const add = async (product: Product) => {
    const nextCart = await run(() => api.addToCart(USER_ID, product.id));
    if (nextCart) onCartChange(nextCart);
  };

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
          <img className="feature-image" src="/images/campsite-hero.jpg" alt="A tent at sunset beneath a mountain ridge" />
          <div className="feature-overlay" />
          <div className="feature-copy">
            <h2 id="feature-title">Make room<br />for outside.</h2>
            <p>Camping essentials for wherever the trail takes you.</p>
            <a className="feature-action" href="#catalog">Explore the gear <span aria-hidden="true">↘</span></a>
          </div>
          <span className="feature-caption">Trailhead Outfitters <span>—</span> Camping collection</span>
        </section>

        <section className="catalog" id="catalog" aria-labelledby="catalog-title">
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
              {products.map((product) => <ProductCard key={product.id} product={product} onAdd={add} />)}
            </div>
          ) : (
            <div className="empty-state">
              <h3>No gear found</h3>
              <p>Try a different search or choose another category.</p>
              <button className="text-button" type="button" onClick={() => { setQuery(''); setCategory(''); }}>Show all gear <span aria-hidden="true">↗</span></button>
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function ProductCard({ product, onAdd }: { product: Product; onAdd: (product: Product) => void }) {
  const art = productArt(product);
  return (
    <article className="product-card">
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
        <button className="add-button" type="button" onClick={() => onAdd(product)} aria-label={`Add ${product.name} to cart`}>
          Add to cart <span aria-hidden="true">+</span>
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

  const update = async (id: number, quantity: number) => {
    const nextCart = await run(() => quantity < 1
      ? api.removeCartItem(USER_ID, id)
      : api.updateCartItem(USER_ID, id, quantity));
    if (nextCart) onCartChange(nextCart);
  };

  const checkout = async () => {
    const order = await run(() => api.placeOrder(USER_ID, address, payment));
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
          <label className="form-field">Shipping address
            <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street, city, ZIP" />
          </label>
          <label className="form-field">Payment method
            <select value={payment} onChange={(event) => setPayment(event.target.value)}>
              <option value="card">Credit card (demo)</option>
              <option value="paypal">PayPal (demo)</option>
            </select>
          </label>
          <button className="primary-button checkout-button" type="button" disabled={!address.trim()} onClick={checkout}>Place demo order <span aria-hidden="true">↗</span></button>
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
            <article className="order-card" key={order.id}>
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
