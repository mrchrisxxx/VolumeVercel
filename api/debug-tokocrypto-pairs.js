const TOKOCRYPTO_TRADING_PAIRS_URL = "https://www.tokocrypto.asia/v1/market/trading-pairs?quoteAsset=IDR&offset=0&limit=100";

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const upstream = await fetch(TOKOCRYPTO_TRADING_PAIRS_URL, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        referer: "https://www.tokocrypto.com/",
        origin: "https://www.tokocrypto.com",
        "user-agent": "Mozilla/5.0",
      },
    });
    const text = await upstream.text();

    response.status(200).json({
      ok: upstream.ok,
      status: upstream.status,
      sample: text.slice(0, 1000),
    });
  } catch (error) {
    response.status(200).json({
      ok: false,
      error: error.message,
    });
  }
};
