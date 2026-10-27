import { useCallback, useEffect, useState } from 'react';
import { useApi } from './api';
import type { Cart, Order, Product } from './types';

const USER_ID = 'demo-user';
const ICONS: Record<string, string> = {
  Tents: '⛺',
  'Sleeping Bags': '🛌',
  'Stoves & Cookware': '🔥',
  Lighting: '🔦',
  Packs: '🎒',
  Hydration: '💧',
};
const money = (n: number) => `$${n.toFixed(2)}`;

type View = 'shop' | 'cart' | 'orders';

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
    const c = await run(() => api.getCart(USER_ID));
    if (c) setCart(c);
  }, [api, run]);

  useEffect(() => {
    refreshCart();
  }, [refreshCart]);

  const cartCount = cart?.items.reduce((n, i) => n + i.quantity, 0) ?? 0;

  return (
    <>
      <header className="nav">
        <h1 onClick={() => setView('shop')}>🏕️ Trailhead Outfitters</h1>
        <nav>
          <button onClick={() => setView('shop')}>Shop</button>
          <button onClick={() => setView('cart')}>Cart ({cartCount})</button>
          <button onClick={() => setView('orders')}>Orders</button>
        </nav>
      </header>
      <main>
        {error && <div className="error" role="alert">⚠️ {error}</div>}
        {view === 'shop' && <Shop run={run} onCartChange={setCart} />}
        {view === 'cart' && <CartView cart={cart} run={run} onCartChange={setCart} onOrdered={() => setView('orders')} />}
        {view === 'orders' && <Orders run={run} />}
      </main>
    </>
  );
}

type Runner = <T>(action: () => Promise<T>) => Promise<T | undefined>;

function Shop({ run, onCartChange }: { run: Runner; onCartChange: (c: Cart) => void }) {
  const api = useApi();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    run(() => api.getCategories()).then((c) => c && setCategories(c));
  }, [api, run]);

  useEffect(() => {
    run(() => api.getProducts(category, query)).then((p) => p && setProducts(p));
  }, [api, run, category, query]);

  const add = async (p: Product) => {
    const c = await run(() => api.addToCart(USER_ID, p.id));
    if (c) onCartChange(c);
  };

  return (
    <>
      <div className="filters">
        <input placeholder="Search gear…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="grid">
        {products.map((p) => (
          <article className="card" key={p.id}>
            <div className="icon">{ICONS[p.category] ?? '🏕️'}</div>
            <h3>{p.name}</h3>
            <p className="muted">{p.category}</p>
            <p>{p.description}</p>
            <div className="row">
              <strong>{money(p.price)}</strong>
              <button onClick={() => add(p)}>Add to cart</button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function CartView({ cart, run, onCartChange, onOrdered }: {
  cart: Cart | null;
  run: Runner;
  onCartChange: (c: Cart) => void;
  onOrdered: () => void;
}) {
  const api = useApi();
  const [address, setAddress] = useState('');
  const [payment, setPayment] = useState('card');

  if (!cart || cart.items.length === 0) return <p>Your cart is empty. Time to gear up!</p>;

  const update = async (id: number, qty: number) => {
    const c = await run(() => (qty < 1 ? api.removeCartItem(USER_ID, id) : api.updateCartItem(USER_ID, id, qty)));
    if (c) onCartChange(c);
  };

  const checkout = async () => {
    const order = await run(() => api.placeOrder(USER_ID, address, payment));
    if (order) {
      const c = await run(() => api.getCart(USER_ID));
      if (c) onCartChange(c);
      onOrdered();
    }
  };

  return (
    <section>
      <h2>Your cart</h2>
      <table>
        <tbody>
          {cart.items.map((i) => (
            <tr key={i.id}>
              <td>{i.product.name}</td>
              <td>
                <button onClick={() => update(i.id, i.quantity - 1)}>−</button> {i.quantity}{' '}
                <button onClick={() => update(i.id, i.quantity + 1)}>+</button>
              </td>
              <td>{money(i.product.price * i.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Total: {money(cart.total)}</h3>
      <div className="filters">
        <input placeholder="Shipping address" value={address} onChange={(e) => setAddress(e.target.value)} />
        <select value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="card">Credit card</option>
          <option value="paypal">PayPal</option>
        </select>
        <button disabled={!address} onClick={checkout}>Place order</button>
      </div>
    </section>
  );
}

function Orders({ run }: { run: Runner }) {
  const api = useApi();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    run(() => api.getOrders(USER_ID)).then((o) => o && setOrders(o));
  }, [api, run]);

  if (orders.length === 0) return <p>No orders yet.</p>;
  return (
    <section>
      <h2>Your orders</h2>
      {orders.map((o) => (
        <article className="card" key={o.id}>
          <div className="row">
            <strong>Order #{o.id}</strong>
            <span className="badge">{o.status}</span>
          </div>
          <p className="muted">{new Date(o.orderDate).toLocaleString()} — {money(o.total)}</p>
          <ul>
            {o.items.map((i) => (
              <li key={i.id}>{i.quantity} × {i.product.name}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
