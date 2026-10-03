import { CACTUS_VARIANTS } from "./cactusVariants";

export const ESSENTIAL_IMAGE_KEYS: ReadonlySet<string> = new Set([
  "raptorSheet",
  "pterodactylSprite",
  ...CACTUS_VARIANTS.map((variant) => variant.key),
]);

export const IMAGE_LOAD_TIMEOUT_MS = 15_000;

/** Failed optional art stays undefined; failed obstacles must prevent a run. */
export async function loadGameImages(
  sources: Record<string, string>,
  images: Record<string, HTMLImageElement | undefined>,
  required: ReadonlySet<string> = ESSENTIAL_IMAGE_KEYS,
): Promise<string[]> {
  const results = await Promise.all(
    Object.entries(sources).map(async ([key, src]) => {
      if (images[key]) return;
      const image = await new Promise<HTMLImageElement | undefined>((resolve) => {
        const img = new Image();
        let settled = false;
        const finish = (loaded: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          img.onload = null;
          img.onerror = null;
          resolve(loaded ? img : undefined);
        };
        const timeout = setTimeout(() => finish(false), IMAGE_LOAD_TIMEOUT_MS);
        img.onload = () => {
          if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return finish(false);
          if (typeof img.decode !== "function") return finish(true);
          img.decode().then(
            () => finish(true),
            () => finish(false),
          );
        };
        img.onerror = () => finish(false);
        img.src = src;
      });
      images[key] = image;
      return !image && required.has(key) ? key : undefined;
    }),
  );
  return results.filter((key): key is string => key !== undefined);
}

export interface LoadingState {
  status: "loading" | "error" | "ready";
  failedAssets: string[];
  message: string | null;
  canRetry: boolean;
}

/** Serialize retries; persistence, listeners, entities and the loop initialize once. */
export class GameStartup {
  private state: LoadingState = {
    status: "loading",
    failedAssets: [],
    message: null,
    canRetry: false,
  };
  private listeners = new Set<(state: LoadingState) => void>();
  private inFlight: Promise<LoadingState> | null = null;
  private preparation: Promise<void> | null = null;
  private initialization: Promise<void> | null = null;

  constructor(
    private prepare: () => Promise<void>,
    private load: () => Promise<string[]>,
    private initialize: () => void | Promise<void>,
  ) {}

  getState(): LoadingState {
    return { ...this.state, failedAssets: [...this.state.failedAssets] };
  }

  subscribe(listener: (state: LoadingState) => void): () => void {
    this.listeners.add(listener);
    queueMicrotask(() => {
      if (this.listeners.has(listener)) this.notify(listener);
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(listener: (state: LoadingState) => void): void {
    try {
      listener(this.getState());
    } catch {
      /* UI must not interrupt startup. */
    }
  }

  private publish(state: LoadingState): void {
    this.state = state;
    for (const listener of this.listeners) this.notify(listener);
  }

  run(): Promise<LoadingState> {
    if (this.inFlight) return this.inFlight;
    if (this.state.status === "ready" || (this.state.status === "error" && !this.state.canRetry)) {
      return Promise.resolve(this.getState());
    }
    // Queue work before notifying listeners so reentrant retries share this promise.
    this.inFlight = Promise.resolve()
      .then(async () => {
        this.publish({ status: "loading", failedAssets: [], message: null, canRetry: false });
        try {
          this.preparation ??= Promise.resolve().then(() => this.prepare());
          await this.preparation;
          const failedAssets = await this.load();
          if (failedAssets.length) {
            this.publish({
              status: "error",
              failedAssets,
              message: "Required game art could not load. Check your connection and retry.",
              canRetry: true,
            });
          } else {
            this.initialization ??= Promise.resolve().then(() => this.initialize());
            await this.initialization;
            this.publish({ status: "ready", failedAssets: [], message: null, canRetry: false });
          }
        } catch {
          // Re-running partial engine setup could duplicate listeners or loops.
          this.publish({
            status: "error",
            failedAssets: [],
            message: "The game could not start. Reload the page to try again.",
            canRetry: false,
          });
        }
        return this.getState();
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
