# Browser regression checks

Run `pnpm build`, then `pnpm test:browser`. The runner checks a random high port,
starts its own production preview, and closes it when the suite finishes.
Tests run in one muted Chromium worker with fresh browser contexts and blocked
service workers. No personal browser profile or live save is used.

On macOS, an installed Google Chrome is used. Elsewhere, install the test browser
once with `pnpm exec playwright install chromium`. Use `pnpm test:browser --grep
"revive"` to run a focused subset. Failure screenshots and traces are saved under
`test-results/`, which is ignored by Git.

The suite covers failed-art retry, custom keyboard input, pause/resume, exact
results, revive affordability, immediate replay, wardrobe previews and purchases,
and a touch-enabled landscape viewport. This does not validate native mobile
services, physical controllers, or late-game balance.
