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

    private static WebApplicationFactory<Program> CreateFactory(string apiVersion = "v1", IRequestAnalyticsCache? analytics = null) =>
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

    [Theory]
    [InlineData("demo-user")]
    [InlineData("shopper-audience-1")]
    public async Task Break_script_and_audience_cart_adds_keep_growing_analytics(string userId)
    {
        var analytics = new CountingAnalytics();
        using var client = CreateFactory(analytics: analytics).CreateClient();
        for (var i = 0; i < 3; i++)
        {
            var response = await client.PostAsJsonAsync($"/api/cart/{userId}/items", new AddCartItemRequest(1, 1));
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        Assert.Equal(3, analytics.EntryCount);
    }

    [Fact]
    public async Task Monitor_cart_checks_functionality_without_growing_analytics()
    {
        var analytics = new RequestAnalyticsCache(
            Microsoft.Extensions.Options.Options.Create(new CampingApiOptions { AnalyticsEntryMegabytes = 1 }),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<RequestAnalyticsCache>.Instance);
        using var client = CreateFactory(analytics: analytics).CreateClient();
        var response = await client.PostAsJsonAsync("/api/cart/presentation-probe/items", new AddCartItemRequest(1, 1));
        var cart = await response.Content.ReadFromJsonAsync<Cart>();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Single(cart!.Items);
        Assert.Equal(0, analytics.EntryCount);
        Assert.Equal(HttpStatusCode.OK, (await client.DeleteAsync("/api/cart/presentation-probe")).StatusCode);
    }

    [Theory]
    [InlineData("demo-user")]
    [InlineData("shopper-audience-2")]
    public void Actual_cache_retains_attendee_and_break_script_buffers(string userId)
    {
        var analytics = new RequestAnalyticsCache(
            Microsoft.Extensions.Options.Options.Create(new CampingApiOptions { AnalyticsEntryMegabytes = 1 }),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<RequestAnalyticsCache>.Instance);
        analytics.Record(userId);
        analytics.Record(userId);
        Assert.Equal(2, analytics.EntryCount);
        analytics.Record("presentation-probe");
        Assert.Equal(2, analytics.EntryCount);
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
