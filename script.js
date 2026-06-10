const REFRESH_INTERVAL_SECONDS = 60;
const RING_CIRCUMFERENCE = 326.73;

const REKU_MARKETS_URL = "https://reku.id/markets";
const INDODAX_TICKERS_URL = "https://indodax.com/api/tickers";
// Menggunakan endpoint v1 yang works dan langsung ambil semua data sekaligus
const TOKOCRYPTO_DIRECT_URL = "https://www.tokocrypto.com/v1/market/trading-pairs?quoteAsset=IDR&offset=0&limit=500";
const LIVE_MARKET_DATA_URL = "/api/market-data";

const fallbackRows = [
  { asset: "USDT", name: "Tether", indodax: 155.522822578, reku: 45.458265578, tokocrypto: 36.994671793 },
  { asset: "BTC", name: "Bitcoin", indodax: 12.962678657, reku: 3.944019959, tokocrypto: 2.684395557 },
  { asset: "ETH", name: "Ethereum", indodax: 4.294305072, reku: 2.435698834, tokocrypto: 1.835621312 },
  { asset: "SOL", name: "Solana", indodax: 4.656879133, reku: 1.498087934, tokocrypto: 1.418643509 },
  { asset: "SUI", name: "SUI", indodax: 2.533712734, reku: 1.142748769, tokocrypto: 0.872873045 },
  { asset: "DOGE", name: "Dogecoin", indodax: 1.48429478, reku: 1.08697245, tokocrypto: 1.183509439 },
  { asset: "HYPE", name: "Hyperliquid", indodax: 18.865391565, reku: 0.888765102, tokocrypto: 0 },
  { asset: "USDC", name: "USD Coin", indodax: 2.646144241, reku: 0.644177536, tokocrypto: 2.57099421 },
  { asset: "XRP", name: "XRP", indodax: 4.302725775, reku: 0.561173988, tokocrypto: 0.841712759 },
  { asset: "TAO", name: "Bittensor", indodax: 0, reku: 0.246718429, tokocrypto: 0.475788472 },
];

let currentRows = [...fallbackRows];
let countdown = REFRESH_INTERVAL_SECONDS;
let refreshTimerId = null;

const elements = {
  body: document.querySelector("#volume-table-body"),
  countdown: document.querySelector("#countdown"),
  ring: document.querySelector("#ring-progress"),
  status: document.querySelector("#refresh-status"),
  sourceStatus: document.querySelector("#source-status"),
  manualRefresh: document.querySelector("#manual-refresh"),
  tableCard: document.querySelector(".table-card"),
  lastRefresh: {
    indodax: document.querySelector("#last-refresh-indodax"),
    reku: document.querySelector("#last-refresh-reku"),
    tokocrypto: document.querySelector("#last-refresh-tokocrypto"),
  },
  summary: {
    increase: document.querySelector("#summary-increase"),
    reduce: document.querySelector("#summary-reduce"),
    maintain: document.querySelector("#summary-maintain"),
  },
};

function calculateAction(indodax, reku, tokocrypto) {
  if (indodax == null || reku == null) return "Review";
  if (tokocrypto == null) return calculateIndodaxOnlyAction(indodax, reku);

  const x = indodax;
  const y = tokocrypto;
  const z = reku;
  const d = x - y;
  const absd = Math.abs(d);

  const betaPos = 0.7 + (1 - 0.7) * (1 / (1 + Math.exp(-0.015 * (d - 350))));
  const alphaPos = 0.007 * (1 - 1 / (1 + Math.exp(-0.015 * (d - 350))));
  const betaNeg = 0.007 * (1 - 1 / (1 + Math.exp(0.1 * (d + 150))));
  const alphaNeg = 0.7 + (0.9 - 0.7) * (1 / (1 + Math.exp(0.1 * (d + 150))));

  const upperPos = x - betaPos * absd;
  const lowerPos = y - alphaPos * absd;
  const upperNeg = y - alphaNeg * absd;
  const lowerNeg = x + betaNeg * absd;

  if (d > 10) {
    if (z > upperPos) return "Reduce";
    if (z < lowerPos) return "Increase";
    return "Maintain";
  }

  if (d <= -10) {
    if (z > upperNeg) return "Reduce";
    if (z < lowerNeg) return "Increase";
    return "Maintain";
  }

  if (z < Math.min(x, y) - 5) return "Increase";
  if (z > Math.max(x, y) + 5) return "Reduce";
  return "Maintain";
}

function calculateIndodaxOnlyAction(indodax, reku) {
  if (reku < indodax - 5) return "Increase";
  if (reku > indodax + 5) return "Reduce";
  return "Maintain";
}

function formatVolume(value) {
  if (value == null || !Number.isFinite(Number(value))) return "N/A";
  return `${Number(value || 0).toFixed(2)} b`;
}

function formatTime(date = new Date()) {
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)} WIB`;
}

function formatServerTime(seconds) {
  return seconds ? formatTime(new Date(Number(seconds) * 1000)) : formatTime();
}

function formatIsoTime(isoString) {
  return isoString ? formatTime(new Date(isoString)) : "Unavailable";
}

function toBillions(value) {
  return Number(value || 0) / 1_000_000_000;
}

function setLoading(isLoading, message = "") {
  elements.status.textContent = isLoading ? "Updating" : "Live";
  elements.sourceStatus.textContent = message;
  elements.tableCard.classList.toggle("is-loading", isLoading);
  elements.manualRefresh.disabled = isLoading;
}

function renderCountdown() {
  elements.countdown.textContent = countdown;
  elements.ring.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - countdown / REFRESH_INTERVAL_SECONDS);
}

function getSortedRows(rows) {
  return [...rows].sort((a, b) => b.reku - a.reku).slice(0, 10);
}

function renderTable(rows) {
  const sortedRows = getSortedRows(rows);

  elements.body.innerHTML = sortedRows
    .map((row) => {
      const action = calculateAction(row.indodax, row.reku, row.tokocrypto);
      const badgeClass = `badge-${action.toLowerCase()}`;

      return `
        <tr>
          <td>
            <span class="asset-cell">
              ${getAssetMark(row)}
              ${row.asset}
            </span>
          </td>
          <td>${formatVolume(row.indodax)}</td>
          <td>${formatVolume(row.reku)}</td>
          <td>${formatVolume(row.tokocrypto)}</td>
          <td><span class="badge ${badgeClass}">${action}</span></td>
        </tr>
      `;
    })
    .join("");

  elements.body.classList.remove("fade-refresh");
  void elements.body.offsetWidth;
  elements.body.classList.add("fade-refresh");
  renderSummary(sortedRows);
}

function getAssetMark(row) {
  if (row.logo) {
    return `<img class="asset-logo" src="${row.logo}" alt="" loading="lazy" />`;
  }
  return `<span class="asset-icon" aria-hidden="true">${row.asset.slice(0, 2)}</span>`;
}

function renderSummary(rows) {
  const actions = rows.map((row) => calculateAction(row.indodax, row.reku, row.tokocrypto));

  elements.summary.increase.textContent = `${actions.filter((action) => action === "Increase").length} assets`;
  elements.summary.reduce.textContent = `${actions.filter((action) => action === "Reduce").length} assets`;
  elements.summary.maintain.textContent = `${actions.filter((action) => action === "Maintain").length} assets`;
}

async function fetchJson(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.text();
}

function parseRekuMarketsPage(html) {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("Reku market JSON not found");

  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf("</script>", jsonStart);
  const json = JSON.parse(html.slice(jsonStart, jsonEnd));
  const markets = json?.props?.pageProps?.initialState?.markets?.markets || [];

  return markets
    .filter((item) => item?.code && item?.price?.volume > 0)
    .map((item) => ({
      asset: item.code,
      name: item.name,
      reku: toBillions(item.price.volume),
    }))
    .sort((a, b) => b.reku - a.reku)
    .slice(0, 10);
}

async function getRekuTopRows() {
  const html = await fetchText(REKU_MARKETS_URL);
  return parseRekuMarketsPage(html);
}

async function getLiveMarketData() {
  return fetchJson(LIVE_MARKET_DATA_URL);
}

async function getIndodaxVolumes(assets) {
  const data = await fetchJson(INDODAX_TICKERS_URL);
  const tickers = data?.tickers || {};
  const serverTime = Object.values(tickers)[0]?.server_time;

  return {
    refreshedAt: formatServerTime(serverTime),
    volumes: Object.fromEntries(
      assets.map((asset) => {
        const ticker = tickers[`${asset.toLowerCase()}_idr`];
        return [asset, toBillions(ticker?.vol_idr)];
      })
    ),
  };
}

// FUNGSI INI DIROMBAK TOTAL: Mengambil data TC langsung dari Client-Side (Browser)
async function getTokocryptoVolumes(assets) {
  try {
    const response = await fetch(TOKOCRYPTO_DIRECT_URL, { cache: "no-store" });
    
    if (!response.ok) {
      throw new Error(`Tokocrypto HTTP ${response.status}`);
    }

    const data = await response.json();
    const list = data?.data?.list || [];
    
    if (!list.length) {
      throw new Error("Data array Tokocrypto kosong");
    }

    // Buat map (dictionary) agar pencarian aset lebih cepat
    const tcVolumesMap = {};
    list.forEach(item => {
      // Ambil Base Asset (contoh: dari "BTCIDR" jadi "BTC")
      if (item.baseAsset && item.quoteVolume) {
        tcVolumesMap[item.baseAsset.toUpperCase()] = toBillions(item.quoteVolume);
      }
    });

    return {
      refreshedAt: formatTime(), // API ini tidak menyertakan timestamp per pasangan, gunakan waktu lokal
      volumes: Object.fromEntries(
        assets.map((asset) => [asset, tcVolumesMap[asset.toUpperCase()] ?? null])
      ),
    };
  } catch (error) {
    console.warn("Client-side Tokocrypto fetch failed:", error);
    throw error;
  }
}

function mergeRows(rekuRows, indodaxVolumes, tokocryptoVolumes) {
  return rekuRows.map((row) => ({
    ...row,
    indodax: indodaxVolumes[row.asset] ?? 0,
    tokocrypto: tokocryptoVolumes[row.asset] ?? 0,
  }));
}

function mergeTokocryptoFallback(rows, tokocryptoVolumes) {
  return rows.map((row) => ({
    ...row,
    tokocrypto: tokocryptoVolumes[row.asset] ?? row.tokocrypto,
  }));
}

async function tryBrowserTokocryptoFallback(rows) {
  const assets = rows.map((row) => row.asset);
  const result = await getTokocryptoVolumes(assets);

  return {
    rows: mergeTokocryptoFallback(rows, result.volumes),
    refreshedAt: result.refreshedAt,
  };
}

// FUNGSI INI DIPERBARUI: Agar selalu memprioritaskan bypass Tokocrypto lewat Client-side
async function refreshDashboard() {
  setLoading(true, "Fetching exchange data...");

  try {
    try {
      // Ambil data Reku dan Indodax dari Vercel
      const marketData = await getLiveMarketData();

      if (Array.isArray(marketData.rows) && marketData.rows.length) {
        currentRows = marketData.rows;
        
        // Update tabel dengan data awal dari Reku dan Indodax
        renderTable(currentRows);
        elements.lastRefresh.reku.textContent = formatIsoTime(marketData.lastRefresh?.reku);
        elements.lastRefresh.indodax.textContent = formatIsoTime(marketData.lastRefresh?.indodax);
        
        // Mulai Bypass Tokocrypto via Browser Client
        setLoading(true, "Fetching Tokocrypto via Client-Side...");
        try {
          const tokocryptoFallback = await tryBrowserTokocryptoFallback(currentRows);
          currentRows = tokocryptoFallback.rows;
          renderTable(currentRows); // Update tabel lagi jika data TC sudah masuk
          elements.lastRefresh.tokocrypto.textContent = tokocryptoFallback.refreshedAt;
          setLoading(false, "Live data refreshed (Bypassed TC)");
        } catch (error) {
          elements.lastRefresh.tokocrypto.textContent = "Unavailable";
          setLoading(false, "Live data refreshed; Tokocrypto blocked");
        }

        countdown = REFRESH_INTERVAL_SECONDS;
        renderCountdown();
        return;
      }
    } catch (error) {
      // Lanjut ke fallback scraping murni via browser jika backend vercel down
    }

    // --- Fallback murni via Browser (Jika Vercel down) ---
    let rekuRows = getSortedRows(currentRows).map(({ asset, name, reku }) => ({ asset, name, reku }));
    let rekuWasLive = false;

    try {
      rekuRows = await getRekuTopRows();
      rekuWasLive = true;
      elements.lastRefresh.reku.textContent = formatTime();
    } catch (error) {
      if (!elements.lastRefresh.reku.textContent) {
        elements.lastRefresh.reku.textContent = "Snapshot fallback";
      }
    }

    const assets = rekuRows.map((row) => row.asset);
    const [indodaxResult, tokocryptoResult] = await Promise.allSettled([
      getIndodaxVolumes(assets),
      getTokocryptoVolumes(assets),
    ]);

    const indodaxVolumes = indodaxResult.status === "fulfilled" ? indodaxResult.value.volumes : Object.fromEntries(currentRows.map((row) => [row.asset, row.indodax]));
    const tokocryptoVolumes = tokocryptoResult.status === "fulfilled" ? tokocryptoResult.value.volumes : Object.fromEntries(currentRows.map((row) => [row.asset, row.tokocrypto]));

    if (indodaxResult.status === "fulfilled") {
      elements.lastRefresh.indodax.textContent = indodaxResult.value.refreshedAt;
    }

    if (tokocryptoResult.status === "fulfilled") {
      elements.lastRefresh.tokocrypto.textContent = tokocryptoResult.value.refreshedAt;
    }

    currentRows = mergeRows(rekuRows, indodaxVolumes, tokocryptoVolumes);
    renderTable(currentRows);

    setLoading(
      false,
      rekuWasLive ? "Live Reku top 10 refreshed (Direct API)" : "Using Reku snapshot; API blocked"
    );
  } catch (error) {
    renderTable(currentRows);
    setLoading(false, "Refresh failed; showing last available snapshot");
  }

  countdown = REFRESH_INTERVAL_SECONDS;
  renderCountdown();
}

function startCountdown() {
  window.clearInterval(refreshTimerId);
  refreshTimerId = window.setInterval(() => {
    countdown -= 1;

    if (countdown <= 0) {
      refreshDashboard();
      return;
    }

    renderCountdown();
  }, 1000);
}

function initDashboard() {
  const now = formatTime();
  elements.lastRefresh.indodax.textContent = now;
  elements.lastRefresh.reku.textContent = "Snapshot fallback";
  elements.lastRefresh.tokocrypto.textContent = now;

  renderTable(currentRows);
  renderCountdown();
  startCountdown();
  refreshDashboard();

  elements.manualRefresh.addEventListener("click", refreshDashboard);
}

document.addEventListener("DOMContentLoaded", initDashboard);
