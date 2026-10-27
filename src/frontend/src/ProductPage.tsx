import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, useApi } from './api';
import { money, productArt } from './catalog';
import type { Product } from './types';

export default function ProductPage({ productId, onAdd, onCategorySelect }: {
  productId: number | null;
  onAdd: (productId: number, quantity: number) => Promise<boolean>;
  onCategorySelect: (category: string) => void;
}) {
  const api = useApi();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [quantity, setQuantity] = useState('1');
  const [adding, setAdding] = useState(false);
  const [addedQuantity, setAddedQuantity] = useState(0);
  const [addFailed, setAddFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setProduct(null);
    const load = async () => {
      try {
        const result = productId === null ? null : await api.getProduct(productId);
        if (active) {
          setProduct(result);
          setNotFound(result === null);
        }
      } catch (e) {
        if (active) {
          if (e instanceof ApiError && e.status === 404) setNotFound(true);
          else setError(e instanceof Error ? e.message : 'Unable to load this item.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [api, productId, attempt]);

  useEffect(() => {
    if (product) document.title = `${product.name} | Trailhead Outfitters`;
  }, [product]);

  if (loading) {
    return <section className="page-content"><div className="loading-state" role="status">Loading product details...</div></section>;
  }

  if (!product) {
    return (
      <section className="page-content product-unavailable">
        <a className="back-link" href="#catalog"><span aria-hidden="true">&larr;</span> Back to the collection</a>
        <div className="empty-state">
          <h1>{notFound ? 'Item not found' : 'This item could not load'}</h1>
          <p role={error ? 'alert' : undefined}>{notFound ? 'This item is not in our catalog. Explore the collection to find your gear.' : error}</p>
          {!notFound && <button className="primary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>}
        </div>
      </section>
    );
  }

  const art = productArt(product);
  const amount = Number(quantity);
  const inStock = product.stockQuantity > 0;
  const validQuantity = quantity.trim() !== '' && Number.isInteger(amount) && amount >= 1 && amount <= product.stockQuantity;
  const quantityError = inStock && !validQuantity ? `Choose a whole number from 1 to ${product.stockQuantity}.` : null;

  const changeQuantity = (delta: number) => {
    setQuantity(String(Math.max(1, Math.min(product.stockQuantity, (validQuantity ? amount : 1) + delta))));
  };

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validQuantity || !inStock || adding) return;
    setAdding(true);
    setAddedQuantity(0);
    setAddFailed(false);
    const success = await onAdd(product.id, amount);
    if (success) setAddedQuantity(amount);
    else setAddFailed(true);
    setAdding(false);
  };

  return (
    <article className="product-page" aria-labelledby="product-title">
      <nav className="product-breadcrumbs" aria-label="Breadcrumb">
        <a href="#catalog">All gear</a><span aria-hidden="true">/</span>
        <a href="#catalog" onClick={() => onCategorySelect(product.category)}>{product.category}</a><span aria-hidden="true">/</span>
        <span aria-current="page">{product.name}</span>
      </nav>

      <div className="product-page-layout">
        <figure className="product-photo">
          <img src={art.src} alt={art.alt} fetchPriority="high" />
          <figcaption>Outdoor photography. Product image is illustrative.</figcaption>
        </figure>

        <div className="product-purchase">
          <h1 id="product-title">{product.name}</h1>
          <p className="detail-price">{money(product.price)} <span>USD / each</span></p>
          <p className={`product-availability${inStock ? '' : ' unavailable'}`}>
            <span aria-hidden="true" />{inStock ? 'In stock' : 'Out of stock'}
          </p>
          <p className="detail-description">{product.description}</p>

          <form className="product-purchase-form" onSubmit={add} noValidate>
            {inStock && (
              <>
                <div className="product-quantity-heading">
                  <label htmlFor="product-quantity">Quantity</label>
                  <span>{product.stockQuantity} available in sample catalog</span>
                </div>
                <div className="product-quantity-row">
                  <div className="detail-quantity">
                    <button type="button" aria-label="Decrease quantity" disabled={adding || (validQuantity && amount <= 1)} onClick={() => changeQuantity(-1)}>-</button>
                    <input id="product-quantity" type="number" inputMode="numeric" min="1" max={product.stockQuantity} step="1" value={quantity} disabled={adding}
                      aria-invalid={quantityError ? true : undefined} aria-describedby={quantityError ? 'quantity-error' : undefined}
                      onChange={(event) => setQuantity(event.target.value)} />
                    <button type="button" aria-label="Increase quantity" disabled={adding || (validQuantity && amount >= product.stockQuantity)} onClick={() => changeQuantity(1)}>+</button>
                  </div>
                  <p className="product-line-total">Subtotal <strong>{validQuantity ? money(product.price * amount) : '--'}</strong></p>
                </div>
                {quantityError && <p className="quantity-error" id="quantity-error" role="alert">{quantityError}</p>}
              </>
            )}
            <button className="primary-button product-add-button" type="submit" disabled={!inStock || !validQuantity || adding}>
              {adding ? 'Adding to cart...' : inStock ? 'Add to cart' : 'Out of stock'} <span aria-hidden="true">+</span>
            </button>
            <div className="product-add-status" role="status" aria-live="polite">
              {addedQuantity > 0 && <><span>{addedQuantity} {addedQuantity === 1 ? 'item' : 'items'} added to your cart.</span> <a href="#/cart">View cart &rarr;</a></>}
            </div>
            {addFailed && <p className="quantity-error" role="alert">This item could not be added. Please try again.</p>}
          </form>

          <dl className="product-facts">
            <div><dt>Category</dt><dd>{product.category}</dd></div>
            <div><dt>Item number</dt><dd>{product.id}</dd></div>
          </dl>
          <p className="product-demo-note">Part of our sample collection. Demo checkout only; no real payment is processed.</p>
          <a className="back-link" href="#catalog"><span aria-hidden="true">&larr;</span> Back to the collection</a>
        </div>
      </div>
    </article>
  );
}
