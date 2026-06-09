const REKU_MARKET_URL = "https://api.reku.id/v3/market";
const INDODAX_TICKERS_URL = "https://indodax.com/api/tickers";
const TOKOCRYPTO_TRADING_PAIRS_URL = "https://www.tokocrypto.com/v1/market/trading-pairs";

const REQUEST_TIMEOUT_MS = 12000;

function toBillions(value) {
  return Number(value || 0) / 1_000_000_000;
}

function nowIso() {
  return new Date().toISOString();
}

async function fetchWithTimeout(url, responseType = "json") {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "user-agent": "Reku Treasury Volume Dashboard/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }

    return responseType === "text" ? response.text() : response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getRekuTopRows() {
  const data = await fetchWithTimeout(REKU_MARKET_URL);
  const rows = Array.isArray(data) ? data : data?.value || [];

  return {
    source: "reku-v3-market",
    rows: rows
      .filter((item) => item?.cd && Number(item?.v) > 0)
      .map((item) => ({
        asset: item.cd,
        name: item.n,
        logo: item.logo || item.logo_svg || "",
        reku: toBillions(item.v),
        rekuRaw: Number(item.v),
      }))
      .sort((a, b) => b.rekuRaw - a.rekuRaw)
      .slice(0, 10),
  };
}

async function getIndodaxVolumes(assets) {
  const data = await fetchWithTimeout(INDODAX_TICKERS_URL);
  const tickers = data?.tickers || {};
  const firstTicker = Object.values(tickers)[0];

  return {
    refreshedAt: firstTicker?.server_time
      ? new Date(Number(firstTicker.server_time) * 1000).toISOString()
      : nowIso(),
    volumes: Object.fromEntries(
      assets.map((asset) => {
        const ticker = tickers[`${asset.toLowerCase()}_idr`];
        return [asset, toBillions(ticker?.vol_idr)];
      })
    ),
  };
}

async function getTokocryptoVolumes(assets) {
  const data = await fetchWithTimeout(
    `${TOKOCRYPTO_TRADING_PAIRS_URL}?quoteAsset=IDR&offset=0&limit=500`
  );

  const pairs = data?.data?.list || [];
  const volumeMap = {};

  for (const pair of pairs) {
    const base = String(pair.baseAsset || "").toUpperCase();
    const quoteVol = Number(pair.quoteVolume || 0);
    if (base && quoteVol > 0) {
      volumeMap[base] = quoteVol / 1_000_000_000;
    }
  }

  return {
    source: "tokocrypto-live",
    refreshedAt: nowIso(),
    volumes: Object.fromEntries(
      assets.map((asset) => [asset, volumeMap[asset] ?? null])
    ),
    errors: [],
  };
}

function mergeRows(rekuRows, indodaxVolumes, tokocryptoVolumes) {
  return rekuRows.map(({ rekuRaw, ...row }) => ({
    ...row,
    indodax: indodaxVolumes[row.asset] ?? null,
    tokocrypto: tokocryptoVolumes[row.asset] ?? null,
  }));
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const errors = [];

  try {
    const rekuResult = await getRekuTopRows();
    const rekuRows = rekuResult.rows;
    const assets = rekuRows.map((row) => row.asset);

    const [indodaxResult, tokocryptoResult] = await Promise.allSettled([
      getIndodaxVolumes(assets),
      getTokocryptoVolumes(assets),
    ]);

    if (indodaxResult.status === "rejected") {
      errors.push({ exchange: "indodax", message: indodaxResult.reason.message });
    }

    if (tokocryptoResult.status === "rejected") {
      errors.push({ exchange: "tokocrypto", message: tokocryptoResult.reason.message });
    }

    const indodax = indodaxResult.status === "fulfilled" ? indodaxResult.value : { volumes: {}, refreshedAt: null };
    const tokocrypto = tokocryptoResult.status === "fulfilled" ? tokocryptoResult.value : { volumes: {}, refreshedAt: null };

    response.status(200).json({
      source: "live",
      rekuSource: rekuResult.source,
      tokocryptoSource: tokocrypto.source || "tokocrypto-live",
      generatedAt: nowIso(),
      lastRefresh: {
        reku: nowIso(),
        indodax: indodax.refreshedAt,
        tokocrypto: tokocrypto.refreshedAt,
      },
      rows: mergeRows(rekuRows, indodax.volumes, tokocrypto.volumes),
      errors: [...errors, ...(tokocrypto.errors || [])],
    });
  } catch (error) {
    response.status(502).json({
      source: "error",
      generatedAt: nowIso(),
      error: error.message,
      rows: [],
      errors,
    });
  }
};
