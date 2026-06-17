const TOKOCRYPTO_PROXY_URL = process.env.TOKOCRYPTO_PROXY_URL || "";
const REQUEST_TIMEOUT_MS = 12000;

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Access-Control-Allow-Origin", "*");

  if (!TOKOCRYPTO_PROXY_URL) {
    response.status(200).json({
      ok: false,
      message: "TOKOCRYPTO_PROXY_URL is not configured",
    });
    return;
  }

  const assets = String(request.query.assets || "USDT,BTC,ETH")
    .split(",")
    .map((asset) => asset.trim().toUpperCase())
    .filter(Boolean);
  const proxyUrl = new URL(TOKOCRYPTO_PROXY_URL);
  proxyUrl.searchParams.set("assets", assets.join(","));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const proxyResponse = await fetch(proxyUrl.toString(), {
      cache: "no-store",
      headers: {
        "user-agent": "Reku Treasury Volume Dashboard/1.0",
      },
      signal: controller.signal,
    });
    const text = await proxyResponse.text();
    let body = null;

    try {
      body = JSON.parse(text);
    } catch (error) {
      body = text.slice(0, 1000);
    }

    response.status(200).json({
      ok: proxyResponse.ok,
      proxyOrigin: proxyUrl.origin,
      requestedAssets: assets,
      status: proxyResponse.status,
      body,
    });
  } catch (error) {
    response.status(200).json({
      ok: false,
      proxyOrigin: proxyUrl.origin,
      requestedAssets: assets,
      error: error.message,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};
