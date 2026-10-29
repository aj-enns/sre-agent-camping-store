# Storefront design system

The storefront is a photo-led camping-gear catalog with the visual language of an expedition equipment label. It serves a demo shopping flow, not a real retailer. Keep SRE lab terminology and controls out of the shopping experience; product, inventory, and order content must remain grounded in the API's demo data.

## Visual language

- **Palette:** charcoal `#121b21` and slate `#1d2931` anchor navigation and panels; cool paper `#f1f3f2` and white provide contrast; safety orange `#f2632e` marks primary actions and active states.
- **Typography:** Barlow Condensed for uppercase display headings and brand marks; DM Sans for interface and body copy. Retain the system-font fallbacks.
- **Surfaces:** crisp, square-edged panels and thin cool-gray rules. Use the orange accent sparingly for emphasis rather than decoration.
- **Photography:** use local, illustrative outdoor photos with descriptive alt text. Do not imply that a photo depicts or endorses the specific demo product. See [image sources and license](IMAGE-CREDITS.md).

## Layout and behavior

- The shop opens with a dark header, category rail, wide campsite feature, and searchable three-column catalog.
- Navigation and shared cart-success/error messages stay pinned together while scrolling. Measure their combined height for anchor-scroll clearance, including wrapped mobile messages; keep live announcements in one shared region.
- At widths up to 1,050px, reduce the catalog to two columns; at 720px, convert the category rail to a horizontal scroller and stack checkout content; at 390px, use one catalog column.
- Keep category filtering, search, cart quantity controls, demo checkout, and order history functional and API-backed.
- Catalog cards open shareable product pages at `#/products/ID`. Product pages pair a large illustrative photo with the API's description, price, availability, and a stock-bounded quantity selector; Add to cart uses the existing API.
- Product pages use a two-column photo/purchase layout, stacking at 720px. Preserve catalog filters when returning, support browser Back/Forward, and show loading, retry, and item-not-found states.
- Provide visible keyboard focus, clear disabled states, and reduced-motion behavior. Preserve readable contrast across dark panels and white surfaces.

## Content guardrails

- Use the API's seeded product names, descriptions, categories, and prices; don't invent reviews, stock counts, promotions, or customer claims.
- Keep the demo-checkout disclosure visible and never suggest that a real payment is processed.
- Keep the footer's sample-catalog and illustrative-photography disclosures.

The product purpose and constraints are documented in [`PRODUCT.md`](../../PRODUCT.md). The implementation's first-viewport brief is in [`index.html`](index.html).
