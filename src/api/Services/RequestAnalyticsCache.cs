namespace CampingApi.Services;

public interface IRequestAnalyticsCache
{
    int EntryCount { get; }
    void Record(string userId);
}

// DEMO BUG (memory leak): every cart request retains a large buffer and nothing ever evicts it.
// The SRE Agent should find this by correlating container memory growth with POST /api/cart/{userId}/items.
public class RequestAnalyticsCache : IRequestAnalyticsCache
{
    private readonly List<byte[]> _entries = new();
    private readonly object _gate = new();
    private readonly int _entryBytes;
    private readonly ILogger<RequestAnalyticsCache> _logger;

    public RequestAnalyticsCache(Microsoft.Extensions.Options.IOptions<CampingApiOptions> options, ILogger<RequestAnalyticsCache> logger)
    {
        _entryBytes = options.Value.AnalyticsEntryMegabytes * 1024 * 1024;
        _logger = logger;
    }

    public int EntryCount
    {
        get { lock (_gate) { return _entries.Count; } }
    }

    public void Record(string userId)
    {
        // TODO: add cache eviction
        var buffer = new byte[_entryBytes];
        Array.Fill(buffer, (byte)1); // touch the pages so the memory is actually committed
        // Exercise the same allocation under memory pressure without retaining probe buffers.
        // Attendee carts and break-app's demo-user still retain every allocation.
        if (userId == "presentation-probe") return;
        int count;
        lock (_gate)
        {
            _entries.Add(buffer);
            count = _entries.Count;
        }

        _logger.LogInformation(
            "Analytics cache: recorded request for {UserId}. Entries={Entries} ApproxSizeMB={SizeMb}",
            userId, count, (long)count * _entryBytes / (1024 * 1024));
    }
}
