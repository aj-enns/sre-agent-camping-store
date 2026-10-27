namespace CampingApi.Services;

public class CampingApiOptions
{
    public const string SectionName = "Camping";

    // "v1" processes payments normally; "v2" simulates a bad payment gateway config (HTTP 500 on checkout).
    public string ApiVersion { get; set; } = "v1";

    public string PaymentGatewayUrl { get; set; } = "https://payments.camping-store.example/v1/process";

    // Size of each entry the analytics cache allocates per cart request.
    public int AnalyticsEntryMegabytes { get; set; } = 10;
}
