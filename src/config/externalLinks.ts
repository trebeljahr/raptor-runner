/*
 * Raptor Runner — external URL constants.
 *
 * Centralizes every outbound link so the marketing pages, the menu
 * buttons, and the about / imprint pages never drift out of sync.
 *
 * Update a URL here and it propagates to the MenuList Steam / itch
 * rows and the About / Imprint footers.
 */

/** Itch.io store page. Standard user-page pattern — replace if the
 *  project slug ever moves. */
export const ITCH_STORE_URL = "https://trebeljahr.itch.io/raptor-runner";

/** Steam store page — app 5035590, same id as steam_appid.txt. */
export const STEAM_STORE_URL = "https://store.steampowered.com/app/5035590/Raptor_Runner/";

/** Steam wishlist add — Steam's own "add to wishlist" flow. Opens
 *  the same page as STEAM_STORE_URL plus the ?wishlist=1 hint that
 *  expands the wishlist CTA. */
export const STEAM_WISHLIST_URL = `${STEAM_STORE_URL}?snr=1_wishlist_`;

/** Author's portfolio. Used in the about-page credit + byline. */
export const PORTFOLIO_URL = "https://portfolio.trebeljahr.com";

/** Public GitHub mirror. */
export const GITHUB_URL = "https://github.com/trebeljahr/velociraptor";

/** Canonical web home. raptor.trebeljahr.com is retired and 301s here,
 *  so every share text, legal link and og:url should use this one. */
export const SITE_URL = "https://raptorrunner.com";
