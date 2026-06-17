# Top 10 Highest Trading Volume Crypto Assets on Reku

Static crypto monitoring dashboard built with HTML, CSS, and Vanilla JavaScript.

## Files

- `index.html`
- `style.css`
- `script.js`
- `api/market-data.js`
- `google-apps-script-tokocrypto-proxy.js`
- `netlify.toml`
- `vercel.json`
- `_redirects`

## Deploy Option 1: Netlify

1. Login to Netlify.
2. Create a new site.
3. Drag and drop this project folder.
4. Netlify will publish the dashboard.
5. Add a custom domain from Site settings > Domain management.

## Deploy Option 2: Vercel

1. Push this folder to a GitHub repository.
2. Import the repository into Vercel.
3. Keep the framework preset as Other.
4. Use root directory as the publish source.
5. Add a custom domain from Project settings > Domains.

## Deploy Option 3: Cloudflare Pages

1. Push this folder to a GitHub repository.
2. Create a Cloudflare Pages project.
3. Select the repository.
4. Leave build command empty.
5. Set output directory to `/`.
6. Add a custom domain from Pages > Custom domains.

## DNS Notes

For a root domain, use the DNS records recommended by the hosting provider.
For a subdomain such as `dashboard.example.com`, add a `CNAME` record pointing to the hosting target.

## Data Notes

The dashboard frontend reads `/api/market-data` first. That endpoint is designed for a Vercel-style serverless deployment and fetches:

- Reku market API
- Indodax public ticker API
- Tokocrypto public ticker API / proxy
- CoinMarketCap exchange market pairs fallback when `CMC_API_KEY` is configured

If `/api/market-data` is unavailable during local static preview, the browser attempts a direct fetch fallback. If a browser blocks a cross-origin request, the dashboard keeps the latest available snapshot instead of generating random mock values.

Reku ranking is based on `https://api.reku.id/v3/market`, not the older `api.reku.id/v2/price` volume field.

## Vercel Environment Variables

Add these in Vercel Project Settings > Environment Variables, then redeploy Production:

- `TOKOCRYPTO_PROXY_URL`: Cloudflare Worker / Google Apps Script / custom proxy URL.
- `CMC_API_KEY`: CoinMarketCap API key for Tokocrypto market-pair fallback.
- `CMC_EXCHANGE_SLUGS`: optional, default `tokocrypto,toko-crypto`.

Tokocrypto volume priority:

1. Tokocrypto direct or `TOKOCRYPTO_PROXY_URL`
2. CoinMarketCap fallback via `CMC_API_KEY`
3. `N/A` when no reliable live source returns data

## Cloudflare Worker Proxy

Use the folder beside this project:

```txt
../reku-volume-dashboard-tokocrypto-worker
```

Deploy `worker.js` as a Cloudflare Worker, then test:

```txt
https://your-worker.workers.dev/?assets=USDT,BTC,ETH
```

If it returns Tokocrypto volumes, set that Worker URL as `TOKOCRYPTO_PROXY_URL` in Vercel and redeploy.

## Google Apps Script Proxy

Use `google-apps-script-tokocrypto-proxy.js` as a free proxy test:

1. Open Google Apps Script.
2. Paste the file content.
3. Deploy as Web App.
4. Set access to Anyone.
5. Put the Web App URL into Vercel as `TOKOCRYPTO_PROXY_URL`.
