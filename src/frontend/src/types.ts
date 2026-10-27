export interface Product {
  id: number;
  name: string;
  category: string;
  description: string;
  price: number;
  stockQuantity: number;
}

export interface CartItem {
  id: number;
  productId: number;
  product: Product;
  quantity: number;
}

export interface Cart {
  userId: string;
  items: CartItem[];
  total: number;
}

export interface Order {
  id: number;
  userId: string;
  items: CartItem[];
  total: number;
  status: string;
  orderDate: string;
  shippingAddress: string;
  paymentMethod: string;
}

declare global {
  interface Window {
    __CONFIG__?: { apiBaseUrl?: string };
  }
}
