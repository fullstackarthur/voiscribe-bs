/**
 * Captures Google auth cookies from a running Chrome instance via CDP.
 * Does NOT use Playwright — no browser is launched by this script.
 *
 * Usage:
 *   1. Run the Chrome launch command printed below in a separate PowerShell window
 *   2. Sign into the bot Google account in that Chrome
 *   3. Navigate to https://meet.google.com
 *   4. Run this script: npx tsx scripts/setup-google-auth.ts
 */
import * as fs from "fs";

const CDP = "http://localhost:9222";

async function getAllCookies(): Promise<any[]> {
  const pages: any[] = await fetch(`${CDP}/json`).then((r) => r.json());
  const target = pages.find((p) => p.type === "page") ?? pages[0];
  if (!target) throw new Error("No pages found in Chrome.");

  const ws = new WebSocket(target.webSocketDebuggerUrl);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP timeout")), 10_000);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Network.getAllCookies" }));
    });
    ws.addEventListener("message", (e: MessageEvent) => {
      const msg = JSON.parse(e.data as string);
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        resolve(msg.result?.cookies ?? []);
      }
    });
    ws.addEventListener("error", () => reject(new Error("WebSocket error — is Chrome running with --remote-debugging-port=9222?")));
  });
}

async function main() {
  // Check if Chrome is reachable first
  let chromeReady = false;
  try {
    await fetch(`${CDP}/json/version`);
    chromeReady = true;
  } catch {
    // not running yet
  }

  if (!chromeReady) {
    console.log("Chrome is not running with remote debugging. Open a new PowerShell window and run:\n");
    console.log(`  & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" \`\n    --remote-debugging-port=9222 \`\n    --user-data-dir="C:\\Temp\\bot-chrome" \`\n    "https://accounts.google.com"\n`);
    console.log("Sign into the bot Google account, navigate to https://meet.google.com,");
    console.log("then re-run this script.\n");
    process.exit(1);
  }

  console.log("Connected to Chrome. Extracting cookies...");
  const cookies = await getAllCookies();

  const googleCookies = cookies.filter((c) =>
    c.domain.includes("google.com") || c.domain.includes("accounts.google")
  );

  const storageState = {
    cookies: googleCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires ?? -1,
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
      sameSite: (c.sameSite as string) ?? "None",
    })),
    origins: [],
  };

  fs.writeFileSync("google-auth-state.json", JSON.stringify(storageState, null, 2));
  console.log(`Saved ${googleCookies.length} Google cookies to google-auth-state.json`);
  console.log("\nNow run:");
  console.log("  gcloud secrets versions add meetingbot-google-auth-state --data-file=google-auth-state.json --project=voiscribe");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
