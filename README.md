# Polymarket Activity Checker

A browser-based tool for viewing public Polymarket wallet activity, positions, balances, and profit and loss across one or more wallet addresses.

**[Open the app](https://polymarket-activity-checker-navy.vercel.app/)**

## How to use

1. Paste a public wallet address beginning with `0x`. For multiple wallets, separate addresses with commas or new lines. Use the wallet address associated with the Polymarket profile you want to inspect.
2. Choose a time range, from **1d** to **All**. The default is **1m** (30 days); shorter ranges usually load faster.
3. Click **Check activity** and wait for the results. Records appear as they load.
4. Select a results tab:
   - **Activity** shows trades, funding transfers, redemptions, rewards, and other supported activity. Filter by type, buy/sell side, category, date, or market text.
   - **Active Position** shows markets with activity in the searched time window, grouped by wallet and outcome/token. Use **Open** for open positions and winnings not yet redeemed, or **Close** for lost, redeemed, and fully sold positions. Select neither or both to show all positions (the default). **Single** and **Combo** filter their type. Rows marked **History** have activity but no position snapshot; they remain in the unfiltered view with unavailable balances and PnL shown as an em dash. Click a position's market cell to expand its details.
5. Click **Export** to download the current filtered activity or positions as CSV. Exports include all loaded matching records, even when the screen shows only a subset.

No wallet connection, private key, seed phrase, or transaction signing is required. The app reads public data and does not place trades.

To remember an address or a list of addresses, click the bookmark button beside the theme button. They are saved only in this browser's local storage. On your next visit, the address field shows them as a gray suggestion; focus the empty field and press **Tab**, or double-click it, to fill the saved addresses, then click **Check activity**. Edit the field and click the bookmark to overwrite the saved list. Clicking again or with an empty field keeps your saved addresses; the button never removes them. Searching alone does not save addresses.

## Reading positions and statistics

| Field | Meaning |
| --- | --- |
| Shares | Number of shares reported for the position. |
| Market time | Scheduled game or event time from market metadata, displayed in the selected timezone (GMT+8 by default). Dates without a published time remain date-only; unavailable schedules show an em dash. Combos with different leg schedules show “Multiple times” with details on hover. CSV exports use ISO timestamps or date-only values. |
| Avg price | Average entry price per share. |
| Cur price | Current reported or estimated price per share. |
| Cost | Position cost basis in USDC, using the supplied `initialValue`. Combo positions use the reported entry cost. An em dash means the cost is unavailable. |
| Fees (est.) | Sum of estimated taker fees on this wallet/outcome's BUY and SELL trades within the searched window and optional date range. These are not lifetime fees or verified charges: makers may pay no fee. An em dash means no matching trades, and “Unavailable” means fee metadata could not be established. |
| Value | Current position value; redeemed rows show the payout received. |
| PnL | Reported position profit or loss and percentage, when available. Redeemed rows use closed-position results when supplied; missing results remain blank. Fees estimates are shown separately and do not alter reported PnL. |
| End date | Reported market end date. |

Single-market holdings and recent market activity sync while the positions view and browser tab are visible, with a 3-second interval after each completed request. Request time is additional; in-flight requests are not duplicated. Each sync reloads shares, average entry price, and cost basis from the positions API and detects newly opened or removed holdings. Open-position market prices are checked independently every second; slow price requests finish before another starts. Quotes always value the latest shares, and a recent market quote is preserved when a holdings snapshot arrives. When the current price changes, the whole ongoing position row briefly flashes green if its PnL is positive or red if negative; unchanged prices and break-even positions do not flash. Unclaimed winning positions remain in **Open** with blue text and no price flashing. New trades also update period fee totals and trigger a closed-position refresh. Missing historical snapshots retry at most once per minute when activity is unchanged. Three green bars beside **Filter markets** count down from 3 to 2 to 1 for holdings synchronization, then pulse during a request and refill when it completes. Hover over the bars for the refresh status. Refreshing pauses while the browser tab is hidden. A failed or incomplete holdings refresh keeps the last known holdings, with red bars indicating an automatic retry and details in the tooltip. Updates still depend on Polymarket's indexing delay; market midpoints are not guaranteed execution prices. Combo holdings reload when you run **Check activity** again; combo prices are estimated from their legs.

The time-range selector applies to both tabs when you click **Check activity**. For example, **1d** shows positions with trades, redemptions, or other market activity in that searched day; an old holding with no activity in that window is excluded. Trades in the same outcome are combined; different outcomes and wallets stay separate. The date inputs narrow this activity window further. **All** includes all fetched snapshots and market activity, subject to API limits. Changing a time-range button alone does not change the applied search until you click **Check activity**.

The window determines which positions appear and which trades contribute fees. Position shares, average price, cost, and PnL retain their authoritative current or closed-position values; they are not reconstructed from partial-day trades. The summary **PnL** and **Portfolio value** cards are not recalculated by the client-side filters below them. Portfolio value refreshes from the absolute value API to avoid drift after sales.

## Display and sharing

- Active Position starts with **Market time**, newest first, and **Wallet** hidden. Unknown times appear last; combos sort by their latest leg. Open **Columns** to change the layout or **Reset columns** to restore defaults.
- Drag a column header's edge to resize it; double-click the edge to reset widths.
- **GMT+8** is the default timezone. Choose **ET** or **GMT+8** in the side panel for timestamps and date filtering; your choice is saved.
- Open **Date range**, select the start and end dates in one calendar, then **Apply**. **Clear** removes the range when applied; Escape cancels unfinished changes.
- Click **Snapshot** to copy the visible results table as an image. If image clipboard access is unavailable, the app downloads a PNG instead.
- Use the theme button to switch between light and dark mode.
- A frosted winter street wallpaper sits behind the glass panels, with gentle snowfall and passing lights. Motion pauses in hidden tabs and respects your device's reduced-motion setting.
- Use **Clear** beside **Check activity** to empty the address field. Saved bookmarks and current results stay available.
- Use **Reset filters** to clear result filters, or **Check activity** again to reload data.

## Data and limitations

The app requests data directly from Polymarket APIs, Polygon Blockscout, and a public Polygon RPC endpoint. Display preferences and addresses you explicitly save are stored in browser local storage. Public wallet addresses used in searches are sent to the relevant data providers; local use does not make those requests private.

- API availability, rate limits, pagination limits, and indexing delays can affect results. Check any incomplete-data messages shown in the app.
- Current-position requests include fractional holdings and archived markets. Closed positions paginate at the endpoint's 50-row limit and deduplicate repeated snapshots.
- Live holdings refresh keeps the previous snapshot if the 2,000-position fetch limit is reached, since an incomplete result cannot reliably identify removed positions.
- Position tables display up to 1,000 rows; exports include all loaded matching rows. Fetch limits still apply to exports.
- Fees are estimates based on available fee schedules; incomplete activity can also make fee totals incomplete. Funding classifications, combo valuations, and reconstructed redemption records may differ from the platform's own accounting.
- If results are missing, verify the wallet address, clear filters, try a shorter activity range, and run the search again.

## Run locally

The app is a static `index.html` with supporting styles, scripts, and wallpaper in `assets/`. No package installation or build step is required.

With Git and Python 3 installed:

```sh
git clone https://github.com/chesterchong/Polymarket-Activity-Checker.git
cd Polymarket-Activity-Checker
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [http://localhost:8000](http://localhost:8000). An internet connection is required to fetch data and external assets. Stop the local server with `Ctrl+C`.

## Manual deployment

Production deployments are manual. The Vercel project's Git repository connection is disconnected, and `vercel.json` disables Git-triggered deployments for all branches. Pushing to GitHub stores the code without publishing it.

From a checkout linked to the existing Vercel project, publish the current local files with:

```sh
vercel deploy --prod --scope chesterchongs-projects
```

For a new checkout, first run `vercel login`, then link it to the existing project:

```sh
vercel link --yes --scope chesterchongs-projects --project polymarket-activity-checker
```

Keep `.vercel` and `.env*` files local. GitHub push and manual deployment are separate actions; commit and push the intended changes before running the deploy command. The production domain remains [polymarket-activity-checker-navy.vercel.app](https://polymarket-activity-checker-navy.vercel.app/).

## Copyright and disclaimer

Copyright © 2026 Chester Chong. All rights reserved in the original project code and documentation, except where otherwise stated. This README does not grant a software license.

Polymarket and other referenced names, trademarks, logos, market images, and third-party content belong to their respective owners. Their appearance here is for identification and informational purposes. This project is independent and is not affiliated with, endorsed by, or sponsored by Polymarket. Third-party libraries and content remain subject to their own licenses and terms.

This tool is provided “as is,” without warranties of accuracy, completeness, availability, or fitness for a particular purpose. It is for informational purposes only and does not provide financial, investment, tax, or legal advice. Verify information against the original sources before relying on it. To the extent permitted by applicable law, the author and contributors are not liable for losses or damages arising from use of the tool.
