namespace CampingApi.Models;

public record Product(
    int Id,
    string Name,
    string Category,
    string Description,
    decimal Price,
    int StockQuantity);

public class CartItem
{
    public int Id { get; set; }
    public int ProductId { get; set; }
    public Product Product { get; set; } = null!;
    public int Quantity { get; set; }
}

public class Cart
{
    public string UserId { get; set; } = string.Empty;
    public List<CartItem> Items { get; set; } = new();
    public decimal Total => Items.Sum(i => i.Product.Price * i.Quantity);
}

public enum OrderStatus
{
    Placed,
    Confirmed,
    Packing,
    Shipped,
    Delivered,
    Cancelled
}

public class Order
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public List<CartItem> Items { get; set; } = new();
    public decimal Total { get; set; }
    public OrderStatus Status { get; set; }
    public DateTime OrderDate { get; set; }
    public string ShippingAddress { get; set; } = string.Empty;
    public string PaymentMethod { get; set; } = string.Empty;
}

public record AddCartItemRequest(int ProductId, int Quantity);

public record UpdateCartItemRequest(int Quantity);

public record PlaceOrderRequest(string UserId, string ShippingAddress, string PaymentMethod);

public record PaymentResult(bool Success, string ErrorMessage);
