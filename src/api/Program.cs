using System.Text.Json.Serialization;
using CampingApi.Services;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
});

// API_VERSION (set by the Dockerfile / container app) selects v1 (healthy) or v2 (broken payments).
builder.Services.Configure<CampingApiOptions>(builder.Configuration.GetSection(CampingApiOptions.SectionName));
var apiVersionOverride = builder.Configuration["API_VERSION"];
if (!string.IsNullOrWhiteSpace(apiVersionOverride))
{
    builder.Services.PostConfigure<CampingApiOptions>(o => o.ApiVersion = apiVersionOverride);
}

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IProductCatalog, InMemoryProductCatalog>();
builder.Services.AddSingleton<IRequestAnalyticsCache, RequestAnalyticsCache>();
builder.Services.AddSingleton<ICartService, InMemoryCartService>();
builder.Services.AddSingleton<IPaymentGateway, PaymentGateway>();
builder.Services.AddSingleton<IOrderService, InMemoryOrderService>();

// App Insights telemetry is enabled when APPLICATIONINSIGHTS_CONNECTION_STRING is set.
if (!string.IsNullOrWhiteSpace(builder.Configuration["APPLICATIONINSIGHTS_CONNECTION_STRING"]))
{
    builder.Services.AddApplicationInsightsTelemetry();
}

// AllowedOrigins__0, AllowedOrigins__1, ... come from container app env vars.
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        var origins = (builder.Configuration.GetSection("AllowedOrigins").Get<string[]>() ?? Array.Empty<string>())
            .Where(o => !string.IsNullOrWhiteSpace(o))
            .ToArray();

        if (origins.Length > 0)
        {
            policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
        }
        else
        {
            policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
        }
    });
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseCors("AllowFrontend");

app.MapGet("/health", (Microsoft.Extensions.Options.IOptions<CampingApiOptions> options) =>
    Results.Ok(new { status = "healthy", service = "camping-api", version = options.Value.ApiVersion }));

app.MapControllers();

app.Run();

public partial class Program;
