using System.Collections.Concurrent;
using CampingApi.Models;

namespace CampingApi.Services;

public interface ICartService
{
    Cart GetCart(string userId);
    Cart AddItem(string userId, int productId, int quantity);
    Cart? UpdateItem(string userId, int itemId, int quantity);
    Cart? RemoveItem(string userId, int itemId);
    void Clear(string userId);
}

public class InMemoryCartService : ICartService
{
    private readonly ConcurrentDictionary<string, Cart> _carts = new();
    private readonly IProductCatalog _catalog;
    private readonly IRequestAnalyticsCache _analytics;

    public InMemoryCartService(IProductCatalog catalog, IRequestAnalyticsCache analytics)
    {
        _catalog = catalog;
        _analytics = analytics;
    }

    public Cart GetCart(string userId) =>
        _carts.GetOrAdd(userId, id => new Cart { UserId = id });

    public Cart AddItem(string userId, int productId, int quantity)
    {
        var product = _catalog.GetById(productId)
            ?? throw new ArgumentException($"Product {productId} not found", nameof(productId));

        _analytics.Record(userId);

        var cart = GetCart(userId);
        lock (cart)
        {
            var existing = cart.Items.FirstOrDefault(i => i.ProductId == productId);
            if (existing != null)
            {
                existing.Quantity += quantity;
            }
            else
            {
                cart.Items.Add(new CartItem
                {
                    Id = cart.Items.Count == 0 ? 1 : cart.Items.Max(i => i.Id) + 1,
                    ProductId = productId,
                    Product = product,
                    Quantity = quantity
                });
            }
        }

        return cart;
    }

    public Cart? UpdateItem(string userId, int itemId, int quantity)
    {
        if (!_carts.TryGetValue(userId, out var cart)) return null;
        lock (cart)
        {
            var item = cart.Items.FirstOrDefault(i => i.Id == itemId);
            if (item == null) return null;
            item.Quantity = quantity;
        }
        return cart;
    }

    public Cart? RemoveItem(string userId, int itemId)
    {
        if (!_carts.TryGetValue(userId, out var cart)) return null;
        lock (cart)
        {
            var item = cart.Items.FirstOrDefault(i => i.Id == itemId);
            if (item == null) return null;
            cart.Items.Remove(item);
        }
        return cart;
    }

    public void Clear(string userId)
    {
        if (_carts.TryGetValue(userId, out var cart))
        {
            lock (cart) { cart.Items.Clear(); }
        }
    }
}
