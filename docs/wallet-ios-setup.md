# iPhone setup — forward Apple Pay transactions to Money Maker

Requires: iOS 17+, the phone on the tailnet (Tailscale app connected), and
a device token created for YOUR user at
https://money-maker.peacock-snapper.ts.net/settings/devices (log in as
yourself — captures are booked as the token's owner).

1. Open **Shortcuts** → Automation tab → **+** → **Transaction**.
2. Pick the card(s) to watch, choose **Run Immediately** (no confirmation).
3. For the automation's shortcut, add these actions:
   - **Dictionary** with keys:
     - `kind` = `ios_transaction`
     - `merchant` = the trigger's **Merchant** variable
     - `amount` = the trigger's **Amount** variable (as text)
     - `cardName` = the trigger's **Card or Pass** variable
     - `postedAt` = **Current Date** formatted as ISO 8601
   - **Get Contents of URL**:
     - URL: `https://money-maker.peacock-snapper.ts.net/api/wallet/capture`
     - Method: POST · Request Body: JSON → the Dictionary above
     - Headers: `Authorization` = `Bearer <YOUR-TOKEN>`
4. Tap to pay. First capture per card lands in /wallet as "Needs account" —
   assign the account and tick "remember card"; after that it's automatic.

Notes:
- The Transaction trigger fires on Apple Pay use only (physical-card swipes
  outside Apple Pay stay manual).
- The trigger's Amount usually carries the currency; if it arrives as a
  bare number the server assumes the mapped account's currency.
