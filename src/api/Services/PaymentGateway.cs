using CampingApi.Models;
using Microsoft.Extensions.Options;

namespace CampingApi.Services;

public interface IPaymentGateway
{
    PaymentResult Charge(string paymentMethod, decimal amount);
}

public class PaymentGateway : IPaymentGateway
{
    private readonly CampingApiOptions _options;
    private readonly ILogger<PaymentGateway> _logger;

    public PaymentGateway(IOptions<CampingApiOptions> options, ILogger<PaymentGateway> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public PaymentResult Charge(string paymentMethod, decimal amount)
    {
        if (_options.ApiVersion.Equals("v2", StringComparison.OrdinalIgnoreCase))
        {
            // DEMO BUG (bad deploy): v2 points at a staging gateway that is unreachable in production.
            const string stagingUrl = "https://payments-staging.internal.example/v1/process";
            _logger.LogError("Payment gateway call to {GatewayUrl} timed out (api version v2)", stagingUrl);
            return new PaymentResult(false, "Connection to payment gateway timed out");
        }

        _logger.LogInformation("Charged {Amount:C} via {GatewayUrl}", amount, _options.PaymentGatewayUrl);
        return new PaymentResult(true, string.Empty);
    }
}
