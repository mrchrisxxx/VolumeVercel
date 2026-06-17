const TOKOCRYPTO_TICKERS_URL = "https://www.tokocrypto.asia/api/v3/ticker/24hr";

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

  try {
    const response = UrlFetchApp.fetch(TOKOCRYPTO_TICKERS_URL, {
      muteHttpExceptions: true,
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0",
      },
    });
    const status = response.getResponseCode();

    if (status < 200 || status >= 300) {
      throw new Error(`ticker list returned ${status}`);
    }

    const tickers = JSON.parse(response.getContentText());
    const bySymbol = {};

    tickers.forEach((ticker) => {
      bySymbol[String(ticker.symbol || "").toUpperCase()] = ticker;
    });

    assets.forEach((asset) => {
      const ticker = bySymbol[`${asset}IDR`];
      const quoteVolume = Number(ticker && ticker.quoteVolume || 0);
      volumes[asset] = quoteVolume > 0 ? quoteVolume / 1000000000 : null;
      latestCloseTime = Math.max(latestCloseTime, Number(ticker && ticker.closeTime || 0));

      if (!ticker) {
        errors.push({ asset, message: `${asset}IDR not found` });
      }
    });
  } catch (error) {
    assets.forEach((asset) => {
      volumes[asset] = null;
    });
    errors.push({ exchange: "tokocrypto", message: error.message });
  }

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
