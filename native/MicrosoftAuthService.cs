using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MoonLauncher;

public sealed class MicrosoftAuthService
{
    private const string ClientId = "09e6a2a2-90ee-47a6-92c4-f8810958de91";
    private const string AuthorizeUrl = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
    private const string TokenUrl = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
    private const string XboxAuthUrl = "https://user.auth.xboxlive.com/user/authenticate";
    private const string XstsUrl = "https://xsts.auth.xboxlive.com/xsts/authorize";
    private const string MinecraftLoginUrl = "https://api.minecraftservices.com/authentication/login_with_xbox";
    private const string ProfileUrl = "https://api.minecraftservices.com/minecraft/profile";
    private const string EntitlementsUrl = "https://api.minecraftservices.com/entitlements/mcstore";
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly string _accountPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MoonLauncher", "microsoft-account.bin");

    public sealed record Account(string Username, string Uuid);

    public Account? GetSavedAccount()
    {
        try
        {
            var protectedBytes = File.ReadAllBytes(_accountPath);
            var clear = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
            using var doc = JsonDocument.Parse(clear);
            var p = doc.RootElement.GetProperty("profile");
            return new Account(p.GetProperty("name").GetString() ?? "Minecraft player", p.GetProperty("id").GetString() ?? "");
        }
        catch { return null; }
    }

    public async Task<Account> SignInAsync(CancellationToken cancellationToken = default)
    {
        var verifier = Base64Url(RandomNumberGenerator.GetBytes(32));
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var state = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
        using var listener = new HttpListener();
        listener.Prefixes.Add("http://localhost:0/");
        // HttpListener does not support port 0 reliably on Windows; reserve a loopback port first.
        var port = ReserveLoopbackPort();
        var redirect = $"http://localhost:{port}/";
        listener.Prefixes.Clear();
        listener.Prefixes.Add(redirect);
        listener.Start();

        var query = new Dictionary<string, string>
        {
            ["client_id"] = ClientId, ["response_type"] = "code", ["redirect_uri"] = redirect,
            ["response_mode"] = "query", ["scope"] = "XboxLive.signin offline_access",
            ["state"] = state, ["code_challenge"] = challenge, ["code_challenge_method"] = "S256",
            ["prompt"] = "select_account"
        };
        var url = AuthorizeUrl + "?" + string.Join("&", query.Select(kv => Uri.EscapeDataString(kv.Key) + "=" + Uri.EscapeDataString(kv.Value)));
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });

        using var registration = cancellationToken.Register(() => { try { listener.Stop(); } catch { } });
        HttpListenerContext callback;
        try { callback = await listener.GetContextAsync().WaitAsync(TimeSpan.FromMinutes(5), cancellationToken); }
        catch (TimeoutException) { throw new InvalidOperationException("Microsoft sign-in timed out. Please try again."); }
        var response = callback.Response;
        string? code = null;
        try
        {
            var args = callback.Request.QueryString;
            if (!string.Equals(args["state"], state, StringComparison.Ordinal))
                throw new InvalidOperationException("Microsoft sign-in could not be verified. Please try again.");
            if (!string.IsNullOrWhiteSpace(args["error"]))
                throw new InvalidOperationException("Microsoft sign-in was not completed: " + (args["error_description"] ?? args["error"]));
            code = args["code"];
            if (string.IsNullOrWhiteSpace(code)) throw new InvalidOperationException("Microsoft did not return an authorization code.");
            var html = Encoding.UTF8.GetBytes("<html><body style='font:16px Segoe UI;padding:40px;background:#100b2a;color:#f5f0ff'><h2>Microsoft sign-in complete</h2><p>You can close this tab and return to Moon Launcher.</p></body></html>");
            response.ContentType = "text/html; charset=utf-8"; response.ContentLength64 = html.Length;
            await response.OutputStream.WriteAsync(html); 
        }
        finally { response.Close(); listener.Stop(); }
        if (code is null) throw new InvalidOperationException("Microsoft did not return an authorization code.");

        using var tokenResponse = await Http.PostAsync(TokenUrl, new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = ClientId, ["grant_type"] = "authorization_code", ["code"] = code,
            ["redirect_uri"] = redirect, ["code_verifier"] = verifier, ["scope"] = "XboxLive.signin offline_access"
        }), cancellationToken);
        var tokenJson = await ReadJsonAsync(tokenResponse, "Microsoft sign-in failed");
        var msToken = tokenJson.GetProperty("access_token").GetString() ?? throw new InvalidOperationException("Microsoft did not return an access token.");

        var xbox = await PostJsonAsync(XboxAuthUrl, new
        {
            Properties = new { AuthMethod = "RPS", SiteName = "user.auth.xboxlive.com", RpsTicket = "d=" + msToken },
            RelyingParty = "http://auth.xboxlive.com", TokenType = "JWT"
        }, "Xbox sign-in failed", cancellationToken);
        var xboxUser = xbox.GetProperty("DisplayClaims").GetProperty("xui")[0];
        var xboxToken = xbox.GetProperty("Token").GetString() ?? throw new InvalidOperationException("Xbox did not return a token.");
        var uhs = xboxUser.GetProperty("uhs").GetString() ?? throw new InvalidOperationException("Xbox did not return a user hash.");

        var xsts = await PostJsonAsync(XstsUrl, new
        {
            Properties = new { SandboxId = "RETAIL", UserTokens = new[] { xboxToken } },
            RelyingParty = "rp://api.minecraftservices.com/", TokenType = "JWT"
        }, "Xbox account check failed", cancellationToken);
        var xstsUser = xsts.GetProperty("DisplayClaims").GetProperty("xui")[0];
        var xstsToken = xsts.GetProperty("Token").GetString() ?? throw new InvalidOperationException("Xbox did not return a security token.");
        uhs = xstsUser.GetProperty("uhs").GetString() ?? uhs;

        var minecraft = await PostJsonAsync(MinecraftLoginUrl, new { identityToken = $"XBL3.0 x={uhs};{xstsToken}" }, "Minecraft account sign-in failed", cancellationToken);
        var gameToken = minecraft.GetProperty("access_token").GetString() ?? throw new InvalidOperationException("Minecraft did not return a game token.");
        using var request = new HttpRequestMessage(HttpMethod.Get, EntitlementsUrl);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", gameToken);
        using var entResponse = await Http.SendAsync(request, cancellationToken);
        var ent = await ReadJsonAsync(entResponse, "Could not check Minecraft ownership");
        if (!ent.GetProperty("items").EnumerateArray().Any(i => new[] { "game_minecraft", "product_minecraft" }.Contains(i.TryGetProperty("name", out var n) ? n.GetString()?.ToLowerInvariant() : "")))
            throw new InvalidOperationException("This Microsoft account does not appear to own Minecraft: Java Edition.");

        using var profileRequest = new HttpRequestMessage(HttpMethod.Get, ProfileUrl);
        profileRequest.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", gameToken);
        using var profileResponse = await Http.SendAsync(profileRequest, cancellationToken);
        var profile = await ReadJsonAsync(profileResponse, "Could not load Minecraft profile");
        var account = new Account(profile.GetProperty("name").GetString() ?? "Minecraft player", profile.GetProperty("id").GetString() ?? "");
        if (string.IsNullOrWhiteSpace(account.Uuid)) throw new InvalidOperationException("This account has no Minecraft: Java Edition profile.");

        var data = JsonSerializer.SerializeToUtf8Bytes(new { profile = new { name = account.Username, id = account.Uuid }, minecraftAccessToken = gameToken, expiresAt = DateTimeOffset.UtcNow.AddSeconds(minecraft.TryGetProperty("expires_in", out var exp) ? exp.GetInt32() : 86400).ToUnixTimeMilliseconds() });
        Directory.CreateDirectory(Path.GetDirectoryName(_accountPath)!);
        var encrypted = ProtectedData.Protect(data, null, DataProtectionScope.CurrentUser);
        var temp = _accountPath + ".tmp";
        await File.WriteAllBytesAsync(temp, encrypted, cancellationToken);
        File.Move(temp, _accountPath, true);
        return account;
    }

    public void SignOut() { try { File.Delete(_accountPath); } catch { } }

    private static int ReserveLoopbackPort()
    {
        using var tcp = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        tcp.Start(); var port = ((System.Net.IPEndPoint)tcp.LocalEndpoint).Port; tcp.Stop(); return port;
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static async Task<JsonElement> PostJsonAsync(string url, object payload, string context, CancellationToken ct)
    {
        using var response = await Http.PostAsync(url, new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"), ct);
        return await ReadJsonAsync(response, context);
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response, string context)
    {
        var body = await response.Content.ReadAsStringAsync();
        JsonDocument? doc = null;
        try { doc = JsonDocument.Parse(body); } catch { }
        if (!response.IsSuccessStatusCode)
        {
            var detail = "";
            if (doc is not null)
            {
                foreach (var key in new[] { "errorMessage", "error_description", "Message", "message", "error" })
                    if (doc.RootElement.TryGetProperty(key, out var v)) { detail = v.ToString(); break; }
            }
            doc?.Dispose();
            if (context == "Minecraft account sign-in failed" && detail.Contains("Invalid app registration", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Minecraft Services rejected this app's client ID. Microsoft must approve it for Minecraft API access; see https://aka.ms/mce-reviewappid.");
            throw new InvalidOperationException(context + (string.IsNullOrWhiteSpace(detail) ? $" (HTTP {(int)response.StatusCode})" : ": " + detail));
        }
        if (doc is null) throw new InvalidOperationException(context + ": the service returned invalid JSON.");
        using (doc) return doc.RootElement.Clone();
    }
}