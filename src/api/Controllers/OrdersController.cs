using CampingApi.Models;
using CampingApi.Services;
using Microsoft.AspNetCore.Mvc;

namespace CampingApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly IOrderService _orders;
    private readonly ILogger<OrdersController> _logger;

    public OrdersController(IOrderService orders, ILogger<OrdersController> logger)
    {
        _orders = orders;
        _logger = logger;
    }

    [HttpPost]
    public ActionResult<Order> PlaceOrder([FromBody] PlaceOrderRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.PaymentMethod))
        {
            return BadRequest("Payment method is required");
        }

        try
        {
            var order = _orders.PlaceOrder(request);
            return CreatedAtAction(nameof(GetOrder), new { id = order.Id }, order);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
        catch (PaymentFailedException ex)
        {
            _logger.LogError(ex, "Payment processing failed for user {UserId}", request.UserId);
            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                error = "Payment processing failed",
                code = "PAYMENT_ERROR",
                message = "Unable to process payment. Please check your payment information and try again.",
                details = ex.Message,
                timestamp = DateTime.UtcNow
            });
        }
    }

    [HttpGet("{id:int}")]
    public ActionResult<Order> GetOrder(int id)
    {
        var order = _orders.GetById(id);
        return order is null ? NotFound() : Ok(order);
    }

    [HttpGet("user/{userId}")]
    public ActionResult<IEnumerable<Order>> GetUserOrders(string userId) => Ok(_orders.GetByUser(userId));

    [HttpPut("{id:int}/cancel")]
    public ActionResult<Order> Cancel(int id)
    {
        try
        {
            var order = _orders.Cancel(id);
            return order is null ? NotFound() : Ok(order);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
    }
}
