const TOKOCRYPTO_TICKERS_URL = "https://www.tokocrypto.site/api/v3/ticker/24hr";

function doGet(event) {
  const assets = String(event.parameter.assets || "")
    .split(",")
    .map((asset) => asset.trim().toUpperCase())
    .filter(Boolean);

  if (!assets.length) {
    return jsonResponse({ error: "Missing assets query parameter" });
  }

  const volumes = {};
  const errors = [];
  let latestCloseTime = 0;

  assets.forEach((asset) => {
    try {
      const response = UrlFetchApp.fetch(`${TOKOCRYPTO_TICKERS_URL}?symbol=${asset}IDR`, {
        muteHttpExceptions: true,
        headers: {
          accept: "application/json",
          "user-agent": "Reku Treasury Volume Dashboard/1.0",
        },
      });
      const status = response.getResponseCode();

      if (status < 200 || status >= 300) {
        throw new Error(`${asset}IDR returned ${status}`);
      }

      const ticker = JSON.parse(response.getContentText());
      volumes[asset] = ticker.quoteVolume ? Number(ticker.quoteVolume) / 1000000000 : null;
      latestCloseTime = Math.max(latestCloseTime, Number(ticker.closeTime || 0));
    } catch (error) {
      volumes[asset] = null;
      errors.push({ asset, message: error.message });
    }
  });

  return jsonResponse({
    source: "google-apps-script-tokocrypto",
    generatedAt: latestCloseTime ? new Date(latestCloseTime).toISOString() : new Date().toISOString(),
    volumes,
    errors,
  });
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
