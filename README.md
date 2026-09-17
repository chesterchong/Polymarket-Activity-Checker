# Polymarket Activity Checker

A browser-based tool for viewing public Polymarket wallet activity, positions, balances, and profit and loss across one or more wallet addresses.

**[Open the app](https://polymarket-activity-checker-navy.vercel.app/)**

## How to use

1. Paste a public wallet address beginning with `0x`. For multiple wallets, separate addresses with commas or new lines. Use the wallet address associated with the Polymarket profile you want to inspect.
2. Choose a time range, from **1d** to **All**. The default is **1m** (30 days); shorter ranges usually load faster.
3. Click **Check activity** and wait for the results. Records appear as they load.
4. Select a results tab:
   - **Activity** shows trades, funding transfers, redemptions, rewards, and other supported activity. Filter by type, buy/sell side, category, date, or market text.
   - **Active Position** shows markets with activity in the searched time window, grouped by wallet and outcome/token. **All** statuses are shown by default. Use **Open**, **Not redeemed**, **Redeemed**, **Loss**, **Sold**, or **History** to narrow the status, and **Single** or **Combo** to filter their type. **History** keeps a market visible when activity is available but its position snapshot is missing; unavailable balances and PnL display an em dash. Click a position's market cell to expand its details.
   - **Json** shows the filtered activity records as formatted JSON.
5. Click **Export** to download the current filtered activity or positions as CSV, or the Json view as JSON. Exports include all loaded matching records, even when the screen shows only a subset.

No wallet connection, private key, seed phrase, or transaction signing is required. The app reads public data and does not place trades.

## Reading positions and statistics

| Field | Meaning |
| --- | --- |
| Shares | Number of shares reported for the position. |
| Avg price | Average entry price per share. |
| Cur price | Current reported or estimated price per share. |
| Cost | Position cost basis in USDC, using the supplied `initialValue`. Combo positions use the reported entry cost. An em dash means the cost is unavailable. |
| Fees (est.) | Sum of estimated taker fees on this wallet/outcome's BUY and SELL trades within the searched window and optional date range. These are not lifetime fees or verified charges: makers may pay no fee. An em dash means no matching trades, and “Unavailable” means fee metadata could not be established. |
| Value | Current position value; redeemed rows show the payout received. |
| PnL | Reported position profit or loss and percentage, when available. Redeemed rows use closed-position results when supplied; missing results remain blank. Fees estimates are shown separately and do not alter reported PnL. |
| End date | Reported market end date. |

Single-market holdings, recent market activity, and open-position prices refresh while the positions view and browser tab are visible, with a 10-second countdown after each refresh completes. Each refresh reloads shares, average entry price, and cost basis from the positions API, detects newly opened or removed holdings, then applies market midpoints to the latest shares. New trades also update period fee totals and trigger a closed-position refresh. Missing historical snapshots retry at most once per minute when activity is unchanged. The countdown beside **Reset filters** shows when the next refresh is due and displays **Refreshing…** during a request. Refreshing pauses while the browser tab is hidden. A failed or incomplete holdings refresh keeps the last known holdings and displays a retry message. Updates still depend on Polymarket's indexing delay; market midpoints are not guaranteed execution prices. Combo holdings reload when you run **Check activity** again; combo prices are estimated from their legs.

The time-range selector applies to both tabs when you click **Check activity**. For example, **1d** shows positions with trades, redemptions, or other market activity in that searched day; an old holding with no activity in that window is excluded. Trades in the same outcome are combined; different outcomes and wallets stay separate. The date inputs narrow this activity window further. **All** includes all fetched snapshots and market activity, subject to API limits. Changing a time-range button alone does not change the applied search until you click **Check activity**.

The window determines which positions appear and which trades contribute fees. Position shares, average price, cost, and PnL retain their authoritative current or closed-position values; they are not reconstructed from partial-day trades. The summary **PnL** and **Portfolio value** cards are not recalculated by the client-side filters below them. Portfolio value refreshes from the absolute value API to avoid drift after sales.

## Display and sharing

- Open **Columns** to hide or reorder columns separately for activity and positions. Use **Reset columns** to restore defaults.
- Drag a column header's edge to resize it; double-click the edge to reset widths.
- Choose **ET** or **GMT+8** in the side panel for activity timestamps and date filtering.
- Click **Snapshot** to copy the visible results table as an image. If image clipboard access is unavailable, the app downloads a PNG instead.
- Use the theme button to switch between light and dark mode.
- Use **Reset filters** to clear result filters, or **Check activity** again to reload data.

## Data and limitations

The app requests data directly from Polymarket APIs, Polygon Blockscout, and a public Polygon RPC endpoint. Display preferences are stored in browser local storage. Public wallet addresses used in searches are sent to the relevant data providers; local use does not make those requests private.

- API availability, rate limits, pagination limits, and indexing delays can affect results. Check any incomplete-data messages shown in the app.
- Current-position requests include fractional holdings and archived markets. Closed positions paginate at the endpoint's 50-row limit and deduplicate repeated snapshots.
- Live holdings refresh keeps the previous snapshot if the 2,000-position fetch limit is reached, since an incomplete result cannot reliably identify removed positions.
- Position tables display up to 1,000 rows; exports include all loaded matching rows. Fetch limits still apply to exports.
- Fees are estimates based on available fee schedules; incomplete activity can also make fee totals incomplete. Funding classifications, combo valuations, and reconstructed redemption records may differ from the platform's own accounting.
- If results are missing, verify the wallet address, clear filters, try a shorter activity range, and run the search again.

## Run locally

The app is a static `index.html` containing its HTML, CSS, and JavaScript. No package installation or build step is required.

With Git and Python 3 installed:

```sh
git clone https://github.com/chesterchong/Polymarket-Activity-Checker.git
cd Polymarket-Activity-Checker
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [http://localhost:8000](http://localhost:8000). An internet connection is required to fetch data and external assets. Stop the local server with `Ctrl+C`.

## Copyright and disclaimer

Copyright © 2026 Chester Chong. All rights reserved in the original project code and documentation, except where otherwise stated. This README does not grant a software license.

Polymarket and other referenced names, trademarks, logos, market images, and third-party content belong to their respective owners. Their appearance here is for identification and informational purposes. This project is independent and is not affiliated with, endorsed by, or sponsored by Polymarket. Third-party libraries and content remain subject to their own licenses and terms.

This tool is provided “as is,” without warranties of accuracy, completeness, availability, or fitness for a particular purpose. It is for informational purposes only and does not provide financial, investment, tax, or legal advice. Verify information against the original sources before relying on it. To the extent permitted by applicable law, the author and contributors are not liable for losses or damages arising from use of the tool.
