using System.Net;
using System.Net.Http.Json;
using CampingApi.Models;
using CampingApi.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace CampingApi.Tests;

public class ApiTests
{
    private sealed class CountingAnalytics : IRequestAnalyticsCache
    {
        public int EntryCount { get; private set; }
        public void Record(string userId) => EntryCount++;
    }

    private static WebApplicationFactory<Program> CreateFactory(string apiVersion = "v1", CountingAnalytics? analytics = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("API_VERSION", apiVersion);
            b.ConfigureServices(s =>
            {
                if (analytics != null)
                {
                    s.RemoveAll<IRequestAnalyticsCache>();
                    s.AddSingleton<IRequestAnalyticsCache>(analytics);
                }
            });
        });

    [Fact]
    public async Task Health_returns_200()
    {
        using var client = CreateFactory().CreateClient();
        var response = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Products_can_be_listed_and_filtered()
    {
        using var client = CreateFactory().CreateClient();
        var all = await client.GetFromJsonAsync<List<Product>>("/api/products");
        var tents = await client.GetFromJsonAsync<List<Product>>("/api/products?category=Tents");
        Assert.NotEmpty(all!);
        Assert.All(tents!, p => Assert.Equal("Tents", p.Category));
    }

    [Fact]
    public async Task Cart_add_records_analytics_through_injected_cache()
    {
        var analytics = new CountingAnalytics();
        using var client = CreateFactory(analytics: analytics).CreateClient();
        var response = await client.PostAsJsonAsync("/api/cart/u1/items", new AddCartItemRequest(1, 2));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, analytics.EntryCount);
    }

    [Fact]
    public async Task Unknown_product_returns_404()
    {
        using var client = CreateFactory(analytics: new CountingAnalytics()).CreateClient();
        var response = await client.PostAsJsonAsync("/api/cart/u1/items", new AddCartItemRequest(9999, 1));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Checkout_succeeds_on_v1()
    {
        using var client = CreateFactory(analytics: new CountingAnalytics()).CreateClient();
        await client.PostAsJsonAsync("/api/cart/u2/items", new AddCartItemRequest(4, 1));
        var response = await client.PostAsJsonAsync("/api/orders", new PlaceOrderRequest("u2", "1 Trail Rd", "card"));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Checkout_returns_500_on_v2()
    {
        using var client = CreateFactory("v2", new CountingAnalytics()).CreateClient();
        await client.PostAsJsonAsync("/api/cart/u3/items", new AddCartItemRequest(4, 1));
        var response = await client.PostAsJsonAsync("/api/orders", new PlaceOrderRequest("u3", "1 Trail Rd", "card"));
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
    }
}
