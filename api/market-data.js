export default async function handler(req, res) {
  // Tambahkan header CORS dan Cache agar respons lebih cepat
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');

  try {
    // 1. Fetch data dari Reku (v3 API) dan Indodax secara paralel untuk mempercepat waktu respons
    const [rekuRes, indodaxRes] = await Promise.all([
      fetch('https://api.reku.id/v3/market').catch(() => null),
      fetch('https://indodax.com/api/tickers').catch(() => null)
    ]);

    // 2. Ekstrak data Reku
    let rekuData = [];
    if (rekuRes && rekuRes.ok) {
      const json = await rekuRes.json();
      // Antisipasi struktur JSON Reku (bisa array langsung, atau di dalam object 'data'/'markets')
      rekuData = Array.isArray(json) ? json : (json.data || json.markets || []);
    }

    // 3. Ekstrak data Indodax
    let indodaxData = {};
    let indodaxServerTime = null;
    if (indodaxRes && indodaxRes.ok) {
      const json = await indodaxRes.json();
      indodaxData = json.tickers || {};
      
      // Ambil timestamp dari salah satu aset Indodax
      const firstTicker = Object.values(indodaxData)[0];
      if (firstTicker && firstTicker.server_time) {
        indodaxServerTime = firstTicker.server_time;
      }
    }

    // Fungsi bantu untuk mengubah volume ke miliar (Billions)
    const toBillions = (val) => Number(val || 0) / 1_000_000_000;

    // 4. Parsing dan Sorting Reku (Ambil Top 10)
    let rows = rekuData.map(item => {
      // Menyesuaikan dengan response keys yang mungkin dari Reku
      const asset = (item.code || item.base_currency || item.symbol || "").toUpperCase();
      const name = item.name || asset;
      const volume = item.volume || (item.price ? item.price.volume : 0);
      
      return { 
        asset, 
        name, 
        reku: toBillions(volume) 
      };
    })
    .filter(item => item.asset && item.reku > 0)
    .sort((a, b) => b.reku - a.reku) // Urutkan dari volume tertinggi ke terendah
    .slice(0, 10); // Ambil hanya Top 10

    // 5. Gabungkan volume Indodax ke dalam Top 10 Reku tersebut
    rows = rows.map(row => {
      const tickerKey = `${row.asset.toLowerCase()}_idr`; // Contoh: "btc_idr"
      const indodaxTicker = indodaxData[tickerKey];
      
      return {
        ...row,
        indodax: indodaxTicker ? toBillions(indodaxTicker.vol_idr) : 0,
        tokocrypto: 0 // Sengaja di-set 0 dari backend, nanti nilainya akan DITIMPA oleh script.js di browser
      };
    });

    // 6. Siapkan timestamp untuk referensi "Last Refresh"
    const now = new Date().toISOString();

    // 7. Kembalikan response JSON ke frontend (script.js)
    return res.status(200).json({
      rows: rows,
      lastRefresh: {
        reku: now,
        indodax: indodaxServerTime ? new Date(indodaxServerTime * 1000).toISOString() : now
      }
    });

  } catch (error) {
    console.error("Vercel Backend Error:", error);
    return res.status(500).json({ 
      error: "Failed to fetch market data", 
      message: error.message 
    });
  }
}
