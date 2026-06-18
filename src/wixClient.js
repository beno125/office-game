import { createClient, OAuthStrategy } from "@wix/sdk";

const clientId = import.meta.env.VITE_WIX_CLIENT_ID;

/**
 * Self-managed Wix Headless browser client.
 * Add domain packages (e.g. `@wix/stores`) and pass them as `modules` when you need those APIs.
 *
 * Dashboard: Settings → Development & integrations → Headless Settings (OAuth client + redirect URIs).
 * @see https://dev.wix.com/docs/go-headless/self-managed-headless/get-started/connect-a-frontend.md
 */
export function getWixClient() {
  if (!clientId) {
    if (import.meta.env.DEV) {
      console.info(
        "[Wix Headless] Set VITE_WIX_CLIENT_ID in .env (OAuth Client ID from Headless Settings).",
      );
    }
    return null;
  }

  return createClient({
    auth: OAuthStrategy({ clientId }),
  });
}
