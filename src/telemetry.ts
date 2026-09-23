/*
 * Raptor Runner — cookieless event telemetry.
 *
 * POSTs named events to the self-hosted Plausible instance at
 * plausible.trebeljahr.com via its Events API. No cookies, no
 * identifiers, no localStorage — Plausible infers a daily-hashed
 * IP+UA signature server-side. Drops us out of GDPR/ePrivacy
 * consent territory entirely, so there's no banner to click past
 * before the game can start.
 *
 * Gating: we only send when running on the production web host
 * (raptorrunner.com). Dev, Electron (file://), and Capacitor
 * (capacitor://) all no-op so desktop/mobile installs don't
 * pollute the web dashboard with identifier-less pageviews that
 * can't be geolocated or deduplicated meaningfully.
 *
 * Call shape:
 *   track("run_end", { score: 475, coins: 40, duration_ms: 62_000 })
 *
 * fetch() runs with keepalive:true so events queued at the tail
 * of a tab-close still reach the server before the renderer
 * tears down.
 */

const PLAUSIBLE_DOMAIN = "raptorrunner.com";
const PLAUSIBLE_ENDPOINT = "https://plausible.trebeljahr.com/api/event";

type Props = Record<string, string | number | boolean>;

/** True iff we're running in a context where sending events makes
 *  sense. We check at call time rather than caching because the
 *  dev-server hostname can differ from the prod one (e.g. IP,
 *  network hostname) and a stale snapshot would leak events. */
function shouldTrack(): boolean {
  if (typeof window === "undefined") return false;
  // Electron: window.electronAPI is installed by the preload script.
  const w = window as unknown as {
    electronAPI?: { isDesktop?: boolean };
    Capacitor?: unknown;
  };
  if (w.electronAPI?.isDesktop) return false;
  if (w.Capacitor) return false;
  // Vite dev server: DEV is true under `vite` / `vite dev`, false
  // under `vite build`. Catches npm run dev without needing a
  // hostname allow-list.
  if (import.meta.env.DEV) return false;
  // Production web only — sidesteps previews, localhost, and any
  // ad-hoc builds served from other domains.
  return window.location.hostname === PLAUSIBLE_DOMAIN;
}

/** Fire a named Plausible event. Silent on failure — telemetry is
 *  never allowed to throw into gameplay code. */
export function track(name: string, props?: Props): void {
  if (!shouldTrack()) return;
  try {
    const body: {
      name: string;
      domain: string;
      url: string;
      referrer: string;
      props?: Props;
    } = {
      name,
      domain: PLAUSIBLE_DOMAIN,
      url: window.location.href,
      referrer: document.referrer || "",
    };
    if (props) body.props = props;
    fetch(PLAUSIBLE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      /* ignore — telemetry is best-effort */
    });
  } catch {
    /* ignore — fetch may throw synchronously on pathological URLs */
  }
}

/** Shorthand for Plausible's built-in "pageview" event. Fire once
 *  at boot; since the game is single-page there are no subsequent
 *  route changes to track. */
export function trackPageview(): void {
  track("pageview");
}
