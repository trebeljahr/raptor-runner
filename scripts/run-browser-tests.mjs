import net from "node:net";
import { spawn } from "node:child_process";
// Choose a checked high port; never attach to another session's preview.
let port;
for (let attempt = 0; attempt < 3; attempt++) {
  const candidate = 49152 + Math.floor(Math.random() * 16383);
  const free = await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(candidate, "127.0.0.1", () => server.close(() => resolve(true)));
  });
  if (free) {
    port = candidate;
    break;
  }
}
if (!port) throw new Error("No free browser-test preview port after three attempts");
const child = spawn(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, RR_TEST_PORT: String(port) },
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
