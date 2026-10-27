using CampingApi.Models;

namespace CampingApi.Services;

public interface IProductCatalog
{
    IReadOnlyList<Product> GetAll();
    Product? GetById(int id);
    IReadOnlyList<Product> Search(string? category, string? query);
    IReadOnlyList<string> GetCategories();
}

public class InMemoryProductCatalog : IProductCatalog
{
    private static readonly Product[] Products =
    {
        new(1, "TrailBlazer 2-Person Tent", "Tents", "Lightweight 3-season backpacking tent with a full-coverage rainfly.", 189.99m, 40),
        new(2, "Basecamp 6-Person Cabin Tent", "Tents", "Spacious family tent with two rooms and a large vestibule.", 329.99m, 15),
        new(3, "Summit 4-Season Mountaineering Tent", "Tents", "Storm-ready geodesic tent for alpine conditions.", 549.00m, 8),
        new(4, "CloudNine 20F Sleeping Bag", "Sleeping Bags", "Mummy bag with water-resistant down insulation, rated to 20F.", 159.95m, 55),
        new(5, "Family Car-Camping Quilt Bag", "Sleeping Bags", "Rectangular synthetic bag that zips together with a partner.", 79.99m, 70),
        new(6, "UltraLight Inflatable Sleeping Pad", "Sleeping Bags", "R-4.5 insulated pad that packs down to the size of a water bottle.", 99.50m, 60),
        new(7, "PocketRocket Backpacking Stove", "Stoves & Cookware", "Ultralight canister stove that boils a liter of water in 3 minutes.", 49.95m, 90),
        new(8, "Camp Chef Two-Burner Stove", "Stoves & Cookware", "Classic propane two-burner stove for the campsite kitchen.", 119.00m, 25),
        new(9, "Titanium Cookset", "Stoves & Cookware", "Pot, pan, and spork set in a compact mesh bag.", 64.00m, 45),
        new(10, "Headlamp 400 Lumen", "Lighting", "Rechargeable headlamp with red night mode.", 39.99m, 120),
        new(11, "Lantern LED Rechargeable", "Lighting", "Collapsible lantern with 3 brightness levels and USB power bank.", 29.99m, 80),
        new(12, "TrekPro 65L Backpack", "Packs", "Adjustable-torso expedition pack with rain cover.", 249.00m, 30),
        new(13, "Daypack 24L", "Packs", "Everyday hiking pack with hydration sleeve.", 74.95m, 65),
        new(14, "Insulated Steel Water Bottle 32oz", "Hydration", "Keeps drinks cold for 24 hours or hot for 12.", 27.50m, 150),
        new(15, "Gravity Water Filter", "Hydration", "4-liter gravity-fed filter for groups, removes 99.9% of bacteria.", 89.00m, 35)
    };

    public IReadOnlyList<Product> GetAll() => Products;

    public Product? GetById(int id) => Products.FirstOrDefault(p => p.Id == id);

    public IReadOnlyList<Product> Search(string? category, string? query) =>
        Products
            .Where(p => string.IsNullOrWhiteSpace(category) || p.Category.Equals(category, StringComparison.OrdinalIgnoreCase))
            .Where(p => string.IsNullOrWhiteSpace(query)
                || p.Name.Contains(query, StringComparison.OrdinalIgnoreCase)
                || p.Description.Contains(query, StringComparison.OrdinalIgnoreCase))
            .ToList();

    public IReadOnlyList<string> GetCategories() =>
        Products.Select(p => p.Category).Distinct().ToList();
}
