using CampingApi.Models;
using CampingApi.Services;
using Microsoft.AspNetCore.Mvc;

namespace CampingApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CartController : ControllerBase
{
    private readonly ICartService _carts;

    public CartController(ICartService carts) => _carts = carts;

    [HttpGet("{userId}")]
    public ActionResult<Cart> GetCart(string userId) => Ok(_carts.GetCart(userId));

    [HttpPost("{userId}/items")]
    public ActionResult<Cart> AddItem(string userId, [FromBody] AddCartItemRequest request)
    {
        if (request.Quantity < 1)
        {
            return BadRequest("Quantity must be at least 1");
        }

        try
        {
            return Ok(_carts.AddItem(userId, request.ProductId, request.Quantity));
        }
        catch (ArgumentException ex)
        {
            return NotFound(ex.Message);
        }
    }

    [HttpPut("{userId}/items/{itemId:int}")]
    public ActionResult<Cart> UpdateItem(string userId, int itemId, [FromBody] UpdateCartItemRequest request)
    {
        var cart = _carts.UpdateItem(userId, itemId, request.Quantity);
        return cart is null ? NotFound("Cart item not found") : Ok(cart);
    }

    [HttpDelete("{userId}/items/{itemId:int}")]
    public ActionResult<Cart> RemoveItem(string userId, int itemId)
    {
        var cart = _carts.RemoveItem(userId, itemId);
        return cart is null ? NotFound("Cart item not found") : Ok(cart);
    }

    [HttpDelete("{userId}")]
    public IActionResult Clear(string userId)
    {
        _carts.Clear(userId);
        return Ok();
    }
}
