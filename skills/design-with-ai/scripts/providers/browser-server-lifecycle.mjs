// Browser ownership for the two independent, anonymous Playwright probes.
// A Browser from chromium.launch() has no supported process()/kill() method.
// BrowserServer instead provides a process-owned shutdown independent of Browser RPC.
// Websocket endpoints and PIDs are intentionally never emitted in receipts.
export async function launchOwnedBrowser(chromium, options, stage, {
  allowInjectedLaunch = false,
} = {}) {
  if (typeof chromium?.launchServer === "function" &&
      typeof chromium?.connect === "function") {
    // Playwright selects an unguessable websocket path; bind it to loopback.
    const server = await stage("launch", () => chromium.launchServer({
      ...options, host: "127.0.0.1",
    }));
    try {
      const browser = await stage("connect", () => chromium.connect(server.wsEndpoint()));
      return { browser, server };
    } catch (error) {
      terminateOwnedBrowser(null, server);
      throw error;
    }
  }
  // Injected test doubles need not implement the BrowserServer API.
  // Never allow this legacy path with the real default package loader.
  if (!allowInjectedLaunch || typeof chromium?.launch !== "function") {
    throw new TypeError("Supported Playwright browser process control unavailable");
  }
  return { browser: await stage("launch", () => chromium.launch(options)), server: null };
}

export function terminateOwnedBrowser(browser, server) {
  if (server) {
    try {
      const pending = server.kill();
      // BrowserServer.kill is process-owned, not Browser RPC.
      Promise.resolve(pending).catch(() => {
        try { server.process?.()?.kill?.("SIGKILL"); } catch { /* best effort */ }
      });
    } catch {
      try { server.process?.()?.kill?.("SIGKILL"); } catch { /* best effort */ }
    }
    return;
  }
  // Injected test doubles may expose process(). This is never the live path.
  try { browser?.process?.()?.kill?.("SIGKILL"); } catch { /* best effort */ }
}
