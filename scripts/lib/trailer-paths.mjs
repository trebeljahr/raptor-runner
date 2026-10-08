// Where trailer clips and cuts live: the main checkout, not a worktree, so
// recordings survive worktree cleanup. `trailer-clips/` is gitignored.

import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Root of the main checkout (the worktree itself when git is unavailable). */
export function mainCheckout(cwd = REPO) {
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
    }).trim();
    return dirname(isAbsolute(common) ? common : resolve(cwd, common));
  } catch {
    return cwd;
  }
}

/** Installed Chrome runs new headless (no window); else Playwright's Chromium. */
export const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
