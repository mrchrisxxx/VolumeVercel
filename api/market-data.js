const REKU_MARKET_URL = "https://api.reku.id/v3/market";
const INDODAX_TICKERS_URL = "https://indodax.com/api/tickers";
const TOKOCRYPTO_TICKERS_URL = "https://www.tokocrypto.asia/api/v3/ticker/24hr";
const TOKOCRYPTO_TRADE_PAGE_URL = "https://www.tokocrypto.asia/en/trade/BTC_IDR";
const TOKOCRYPTO_PROXY_URL = process.env.TOKOCRYPTO_PROXY_URL || "";
const CMC_API_KEY = process.env.CMC_API_KEY || "";
const CMC_EXCHANGE_SLUGS = (process.env.CMC_EXCHANGE_SLUGS || process.env.CMC_EXCHANGE_SLUG || "tokocrypto,toko-crypto")
  .split(",")
  .map((slug) => slug.trim())
  .filter(Boolean);
const CMC_MARKET_PAIRS_URL = "https://pro-api.coinmarketcap.com/v1/exchange/market-pairs/latest";

const REQUEST_TIMEOUT_MS = 12000;

function toBillions(value) {
  return Number(value || 0) / 1_000_000_000;
}

function nowIso() {
  return new Date().toISOString();
}

async function fetchWithTimeout(url, responseType = "json", headers = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "user-agent": "Reku Treasury Volume Dashboard/1.0",
        ...headers,
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
  const errors = [];
  let primaryResult = null;
  let cmcResult = null;

  try {
    primaryResult = TOKOCRYPTO_PROXY_URL
      ? await getTokocryptoProxyVolumes(assets)
      : await getTokocryptoDirectVolumes(assets);
  } catch (error) {
    errors.push({ exchange: "tokocrypto", message: error.message });
  }

  const volumes = Object.fromEntries(
    assets.map((asset) => [asset, primaryResult?.volumes?.[asset] ?? null])
  );
  const missingAssets = assets.filter((asset) => volumes[asset] == null);

  if (missingAssets.length && CMC_API_KEY) {
    try {
      cmcResult = await getCoinMarketCapTokocryptoVolumes(missingAssets);

      for (const asset of missingAssets) {
        volumes[asset] = cmcResult.volumes[asset] ?? volumes[asset];
      }
    } catch (error) {
      errors.push({ exchange: "coinmarketcap", message: error.message });
    }
  }

  const hasAnyVolume = Object.values(volumes).some((value) => value != null);

  if (!hasAnyVolume) {
    const detail = [...errors, ...(primaryResult?.errors || []), ...(cmcResult?.errors || [])]
      .map((item) => item.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(
      detail
        ? `Tokocrypto volume unavailable from direct/proxy and CoinMarketCap fallback: ${detail}`
        : "Tokocrypto volume unavailable from direct/proxy and CoinMarketCap fallback"
    );
  }

  return {
    source: [primaryResult?.source, cmcResult?.source].filter(Boolean).join("+") || "tokocrypto",
    refreshedAt: cmcResult?.refreshedAt || primaryResult?.refreshedAt || nowIso(),
    volumes,
    errors: [...errors, ...(primaryResult?.errors || []), ...(cmcResult?.errors || [])],
  };
}

async function getTokocryptoDirectVolumes(assets) {
  const rows = await Promise.all(
    assets.map(async (asset) => {
      try {
        return await fetchWithTimeout(`${TOKOCRYPTO_TICKERS_URL}?symbol=${encodeURIComponent(`${asset}IDR`)}`);
      } catch (error) {
        return null;
      }
    })
  );

  const validRows = rows.filter(Boolean);
  const bySymbol = new Map(validRows.map((item) => [item.symbol, item]));
  const relevantTickers = assets.map((asset) => bySymbol.get(`${asset}IDR`)).filter(Boolean);
  const latestCloseTime = Math.max(...relevantTickers.map((item) => Number(item.closeTime || 0)));
  const apiVolumes = Object.fromEntries(
    assets.map((asset) => {
      const ticker = bySymbol.get(`${asset}IDR`);
      return [asset, ticker ? toBillions(ticker.quoteVolume) : null];
    })
  );
  const missingAssets = assets.filter((asset) => apiVolumes[asset] == null);

  if (missingAssets.length) {
    const webFallback = await getTokocryptoWebFallbackVolumes(missingAssets);

    for (const asset of missingAssets) {
      apiVolumes[asset] = webFallback.volumes[asset] ?? apiVolumes[asset];
    }
  }

  const hasAnyVolume = Object.values(apiVolumes).some((value) => value != null);

  if (!hasAnyVolume) {
    throw new Error("Tokocrypto volume unavailable from ticker API and trade page fallback");
  }

  return {
    source: "tokocrypto-direct",
    refreshedAt: latestCloseTime > 0
      ? new Date(latestCloseTime).toISOString()
      : nowIso(),
    volumes: apiVolumes,
  };
}

async function getCoinMarketCapTokocryptoVolumes(assets) {
  let data = null;
  let usedSlug = "";

  for (const slug of CMC_EXCHANGE_SLUGS) {
    try {
      const url = new URL(CMC_MARKET_PAIRS_URL);
      url.searchParams.set("slug", slug);
      url.searchParams.set("convert", "IDR");
      url.searchParams.set("limit", "500");

      data = await fetchWithTimeout(url.toString(), "json", {
        "X-CMC_PRO_API_KEY": CMC_API_KEY,
        accept: "application/json",
      });
      usedSlug = slug;
      break;
    } catch (error) {
      data = null;
    }
  }

  if (!data) {
    throw new Error("CoinMarketCap Tokocrypto market pairs unavailable");
  }

  const pairs = data?.data?.market_pairs || [];
  const volumes = Object.fromEntries(assets.map((asset) => [asset, null]));
  let latestUpdatedAt = null;

  for (const pair of pairs) {
    const baseSymbol = String(pair?.market_pair_base?.currency_symbol || "").toUpperCase();
    const quoteSymbol = String(pair?.market_pair_quote?.currency_symbol || "").toUpperCase();

    if (!assets.includes(baseSymbol) || quoteSymbol !== "IDR") {
      continue;
    }

    const exchangeReported = pair?.quote?.exchange_reported || {};
    const idrQuote = pair?.quote?.IDR || {};
    const rawVolume =
      Number(exchangeReported.volume_24h_quote) ||
      Number(idrQuote.volume_24h) ||
      0;

    if (rawVolume > 0) {
      volumes[baseSymbol] = toBillions(rawVolume);
    }

    latestUpdatedAt = exchangeReported.last_updated || idrQuote.last_updated || latestUpdatedAt;
  }

  return {
    source: `coinmarketcap-${usedSlug}`,
    refreshedAt: latestUpdatedAt || nowIso(),
    volumes,
    errors: [],
  };
}

async function getTokocryptoProxyVolumes(assets) {
  const url = new URL(TOKOCRYPTO_PROXY_URL);
  url.searchParams.set("assets", assets.join(","));
  const data = await fetchWithTimeout(url.toString());
  const volumes = data?.volumes || {};

  return {
    source: data?.source || "tokocrypto-proxy",
    refreshedAt: data?.generatedAt || nowIso(),
    volumes: Object.fromEntries(
      assets.map((asset) => {
        const value = volumes[asset] ?? volumes[asset.toUpperCase()] ?? null;
        return [asset, value == null ? null : Number(value)];
      })
    ),
    errors: data?.errors || [],
  };
}

async function getTokocryptoWebFallbackVolumes(assets) {
  const html = await fetchWithTimeout(TOKOCRYPTO_TRADE_PAGE_URL, "text");

  return {
    refreshedAt: nowIso(),
    volumes: Object.fromEntries(
      assets.map((asset) => {
        const symbol = `${asset}IDR`;
        const symbolPattern = new RegExp(`"${symbol}"\\s*:\\s*\\{([^{}]+)\\}`);
        const symbolMatch = html.match(symbolPattern);

        if (!symbolMatch) {
          return [asset, null];
        }

        const quoteVolumeMatch = symbolMatch[1].match(/"quoteVolume"\s*:\s*"([^"]+)"/);
        return [asset, quoteVolumeMatch ? toBillions(quoteVolumeMatch[1]) : null];
      })
    ),
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
    const tokocrypto =
      tokocryptoResult.status === "fulfilled" ? tokocryptoResult.value : { volumes: {}, refreshedAt: null };

    response.status(200).json({
      source: "live",
      rekuSource: rekuResult.source,
      tokocryptoSource: tokocrypto.source || (TOKOCRYPTO_PROXY_URL ? "tokocrypto-proxy" : "tokocrypto-direct"),
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
