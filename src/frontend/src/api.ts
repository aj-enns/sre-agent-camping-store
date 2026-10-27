import { createContext, useContext } from 'react';
import type { Cart, Order, Product } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class ApiClient {
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

  placeOrder(userId: string, shippingAddress: string, paymentMethod: string) {
    return this.request<Order>('/orders', {
      method: 'POST',
      body: JSON.stringify({ userId, shippingAddress, paymentMethod }),
    });
  }

  getOrders(userId: string) {
    return this.request<Order[]>(`/orders/user/${userId}`);
  }
}

export const defaultApiClient = () =>
  new ApiClient(window.__CONFIG__?.apiBaseUrl ?? 'http://localhost:5000/api');

// The client is provided via context so components can be tested with a fake.
export const ApiContext = createContext<ApiClient>(defaultApiClient());
export const useApi = () => useContext(ApiContext);
