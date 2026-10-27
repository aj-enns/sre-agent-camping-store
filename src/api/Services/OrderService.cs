using CampingApi.Models;

namespace CampingApi.Services;

public class PaymentFailedException : Exception
{
    public PaymentFailedException(string message) : base(message) { }
}

public interface IOrderService
{
    Order PlaceOrder(PlaceOrderRequest request);
    Order? GetById(int id);
    IReadOnlyList<Order> GetByUser(string userId);
    Order? Cancel(int id);
}

public class InMemoryOrderService : IOrderService
{
    private readonly List<Order> _orders = new();
    private readonly object _gate = new();
    private int _nextId = 1;

    private readonly ICartService _carts;
    private readonly IPaymentGateway _payments;
    private readonly TimeProvider _time;

    public InMemoryOrderService(ICartService carts, IPaymentGateway payments, TimeProvider time)
    {
        _carts = carts;
        _payments = payments;
        _time = time;
    }

    public Order PlaceOrder(PlaceOrderRequest request)
    {
        var cart = _carts.GetCart(request.UserId);
        if (cart.Items.Count == 0)
        {
            throw new InvalidOperationException("Cart is empty");
        }

        var payment = _payments.Charge(request.PaymentMethod, cart.Total);
        if (!payment.Success)
        {
            throw new PaymentFailedException(payment.ErrorMessage);
        }

        var order = new Order
        {
            UserId = request.UserId,
            Items = cart.Items.Select(i => new CartItem
            {
                Id = i.Id, ProductId = i.ProductId, Product = i.Product, Quantity = i.Quantity
            }).ToList(),
            Total = cart.Total,
            Status = OrderStatus.Placed,
            OrderDate = _time.GetUtcNow().UtcDateTime,
            ShippingAddress = request.ShippingAddress,
            PaymentMethod = request.PaymentMethod
        };

        lock (_gate)
        {
            order.Id = _nextId++;
            _orders.Add(order);
        }

        _carts.Clear(request.UserId);
        return order;
    }

    public Order? GetById(int id)
    {
        lock (_gate) { return Refresh(_orders.FirstOrDefault(o => o.Id == id)); }
    }

    public IReadOnlyList<Order> GetByUser(string userId)
    {
        lock (_gate) { return _orders.Where(o => o.UserId == userId).Select(o => Refresh(o)!).ToList(); }
    }

    public Order? Cancel(int id)
    {
        lock (_gate)
        {
            var order = Refresh(_orders.FirstOrDefault(o => o.Id == id));
            if (order == null) return null;
            if (order.Status is OrderStatus.Shipped or OrderStatus.Delivered)
            {
                throw new InvalidOperationException("Order can no longer be cancelled");
            }
            order.Status = OrderStatus.Cancelled;
            return order;
        }
    }

    // Order progress is derived from age so no background work is needed.
    private Order? Refresh(Order? order)
    {
        if (order == null || order.Status == OrderStatus.Cancelled) return order;
        var age = _time.GetUtcNow().UtcDateTime - order.OrderDate;
        order.Status = age.TotalMinutes switch
        {
            < 1 => OrderStatus.Placed,
            < 10 => OrderStatus.Confirmed,
            < 30 => OrderStatus.Packing,
            < 120 => OrderStatus.Shipped,
            _ => OrderStatus.Delivered
        };
        return order;
    }
}
