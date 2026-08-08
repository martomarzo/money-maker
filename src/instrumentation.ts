// Runs once per server boot: refresh FX rates immediately, then daily.
// Failures are logged and retried on the next cycle — the app works without
// rates (converted totals just show a pending state).

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { fetchAndStoreLatestRates, backfillMissingFxRates } = await import(
    "@/lib/fx"
  );

  const refresh = async () => {
    try {
      await fetchAndStoreLatestRates();
      const backfilled = await backfillMissingFxRates();
      if (backfilled > 0) {
        console.log(`[fx] backfilled ${backfilled} transaction rates`);
      }
    } catch (error) {
      console.error("[fx] rate refresh failed:", error);
    }
  };

  await refresh();
  setInterval(refresh, 24 * 60 * 60 * 1000);
}
