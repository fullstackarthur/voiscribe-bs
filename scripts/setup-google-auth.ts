/**
 * Captures Google auth state using Playwright's own browser (with anti-detection).
 * This ensures the storageState format is 100% compatible with the worker.
 *
 * Usage:
 *   npx tsx scripts/setup-google-auth.ts
 *
 * A browser window will open. Sign in to the bot Google account,
 * then navigate to https://meet.google.com
 * The script saves auth state automatically and exits.
 */
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const AUTH_DIR = path.join(os.tmpdir(), "meetingbot-auth-capture");

async function captureAuthState() {
  console.log("Opening browser. Sign in to the BOT Google account.");
  console.log("Then navigate to https://meet.google.com");
  console.log("The script saves auth state automatically and exits.\n");

  const context = await chromium.launchPersistentContext(AUTH_DIR, {
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--start-maximized",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  // Hide navigator.webdriver to bypass Google's bot detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    // @ts-ignore
    delete window.__playwright;
    // @ts-ignore
    delete window.__pwInitScripts;
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("https://accounts.google.com");

  console.log("Waiting for you to navigate to meet.google.com after signing in...\n");

  await page.waitForURL("**/meet.google.com**", { timeout: 300_000 });

  // Wait a moment for all cookies to settle
  await page.waitForTimeout(2_000);

  console.log("Detected meet.google.com — saving auth state...");

  const storageState = await context.storageState();
  const json = JSON.stringify(storageState, null, 2);

  fs.writeFileSync("google-auth-state.json", json);

  const cookieCount = storageState.cookies.length;
  console.log(`Saved ${cookieCount} cookies to google-auth-state.json`);
  console.log("\nNow run:");
  console.log(
    "  gcloud secrets versions add meetingbot-google-auth-state --data-file=google-auth-state.json --project=voiscribe"
  );

  await context.close();

  // Cleanup temp dir
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
}

captureAuthState().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
