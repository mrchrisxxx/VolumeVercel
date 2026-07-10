const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/24hr";

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Access-Control-Allow-Origin", "*");

  const symbol = String(request.query.symbol || "USDTIDR").toUpperCase();

  try {
    const upstream = await fetch(`${BINANCE_TICKER_URL}?symbol=${encodeURIComponent(symbol)}`, {
      cache: "no-store",
      headers: {
        "user-agent": "Reku Treasury Volume Dashboard/1.0",
      },
    });
    const text = await upstream.text();
    let body = text;

    try {
      body = JSON.parse(text);
    } catch (error) {
      body = text.slice(0, 1000);
    }

    response.status(200).json({
      ok: upstream.ok,
      status: upstream.status,
      symbol,
      body,
    });
  } catch (error) {
    response.status(200).json({
      ok: false,
      symbol,
      error: error.message,
    });
  }
};
