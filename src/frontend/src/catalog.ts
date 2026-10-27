import type { Product } from './types';

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

export function productArt(product: Product) {
  return PRODUCT_ART[product.id] ?? CATEGORY_ART[product.category] ?? CATEGORY_ART.Tents;
}

export const money = (amount: number) => `$${amount.toFixed(2)}`;
