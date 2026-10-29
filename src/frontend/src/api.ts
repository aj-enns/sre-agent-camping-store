import { createContext, useContext } from 'react';
import type { Cart, Order, Product } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class ApiClient {
  private checkoutKey: string | null = null;
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      let message = `Request failed (HTTP ${response.status})`;
      try {
        const body = await response.json();
        message = body.message ?? body.error ?? message;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(response.status, message);
    }
    return response.status === 204 ? (undefined as T) : response.json();
  }

  getProducts(category?: string, q?: string) {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (q) params.set('q', q);
    return this.request<Product[]>(`/products?${params}`);
  }

  getCategories() {
    return this.request<string[]>('/products/categories');
  }

  getProduct(id: number) {
    return this.request<Product>(`/products/${id}`);
  }

  getCart(userId: string) {
    return this.request<Cart>(`/cart/${userId}`);
  }

  addToCart(userId: string, productId: number, quantity = 1) {
    return this.request<Cart>(`/cart/${userId}/items`, {
      method: 'POST',
      body: JSON.stringify({ productId, quantity }),
    });
  }

  updateCartItem(userId: string, itemId: number, quantity: number) {
    return this.request<Cart>(`/cart/${userId}/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ quantity }),
    });
  }

  removeCartItem(userId: string, itemId: number) {
    return this.request<Cart>(`/cart/${userId}/items/${itemId}`, { method: 'DELETE' });
  }

  async placeOrder(userId: string, shippingAddress: string, paymentMethod: string) {
    const storageKey = `trailhead-checkout-${userId}`;
    this.checkoutKey ??= sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
    sessionStorage.setItem(storageKey, this.checkoutKey);
    try {
      const order = await this.request<Order>('/orders', {
        method: 'POST', headers: { 'Idempotency-Key': this.checkoutKey },
        body: JSON.stringify({ userId, shippingAddress, paymentMethod }),
      });
      this.checkoutKey = null;
      sessionStorage.removeItem(storageKey);
      return order;
    } catch (error) {
      if (error instanceof ApiError && error.status !== 409 && error.status !== 502 && error.status < 500) {
        this.checkoutKey = null;
        sessionStorage.removeItem(storageKey);
      }
      throw error;
    }
  }

  getOrders(userId: string) {
    return this.request<Order[]>(`/orders/user/${userId}`);
  }
}

export const defaultApiClient = () =>
  new ApiClient(window.__CONFIG__?.apiBaseUrl ?? '/api');

// The client is provided via context so components can be tested with a fake.
export const ApiContext = createContext<ApiClient>(defaultApiClient());
export const useApi = () => useContext(ApiContext);
