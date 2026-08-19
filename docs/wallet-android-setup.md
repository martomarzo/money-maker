# Android setup — forward Google Wallet payments to Money Maker

Requires: the phone on the tailnet (Tailscale app connected) and a device
token from https://money-maker.peacock-snapper.ts.net/settings/devices.

1. Install **MacroDroid** (free tier is enough). Grant it Notification
   Access when prompted (Settings → Notifications → Notification access).
2. Create a macro:
   - **Trigger:** Notification → Notification Received → Select
     Application(s) → **Google Wallet**. (Optionally also add your bank
     apps, e.g. Revolut — some banks post the payment notification
     themselves and Wallet stays silent.)
   - **Action:** Connectivity → **HTTP Request**:
     - Method: POST
     - URL: `https://money-maker.peacock-snapper.ts.net/api/wallet/capture`
     - Content type: `application/json`
     - Header: name `Authorization`, value `Bearer <YOUR-TOKEN>`
     - Body (insert the {…} placeholders via the magic-text picker — the
       exact token names in your MacroDroid version may differ slightly;
       pick "Notification title", "Notification text", "App package"):

       {"kind":"android_notification","app":"{not_app_package}","title":"{not_title}","text":"{notification}","postedAt":"{year}-{month_digit}-{dayofmonth}T{hour_0}:{minute}:00"}

   - **Constraints:** none needed.
3. Tap a card payment. Within seconds the purchase appears in
   /transactions (if the card is mapped) or in /wallet as "Needs account"
   (first time — assign the account there and tick "remember card").

Notes:
- If the notification text ever contains a double quote the JSON breaks;
  the server then stores the raw body as an unparsed capture — nothing is
  lost, book it manually from /wallet.
- Battery optimization can kill MacroDroid — exclude it (MacroDroid shows
  a warning with a shortcut to the setting).
