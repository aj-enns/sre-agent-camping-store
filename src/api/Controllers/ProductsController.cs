using CampingApi.Services;
using Microsoft.AspNetCore.Mvc;

namespace CampingApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    private readonly IProductCatalog _catalog;

    public ProductsController(IProductCatalog catalog) => _catalog = catalog;

    [HttpGet]
    public IActionResult GetAll([FromQuery] string? category, [FromQuery] string? q) =>
        Ok(_catalog.Search(category, q));

    [HttpGet("{id:int}")]
    public IActionResult GetById(int id)
    {
        var product = _catalog.GetById(id);
        return product is null ? NotFound() : Ok(product);
    }

    [HttpGet("categories")]
    public IActionResult GetCategories() => Ok(_catalog.GetCategories());
}
