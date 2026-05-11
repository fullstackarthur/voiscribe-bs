/**
 * Captures Google auth state using Playwright's own browser.
 *
 * Usage:
 *   npx ts-node scripts/setup-google-auth.ts
 *
 * A browser window will open. Sign in to the bot Google account.
 * Once signed in, press Enter in this terminal to save the cookies.
 */
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

const AUTH_DIR = path.join(os.tmpdir(), "meetingbot-auth-capture");

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    process.stdout.write("\n>>> Sign into the bot Google account in the browser, then press ENTER here to save cookies: ");
    rl.once("line", () => {
      rl.close();
      resolve();
    });
  });
}

async function captureAuthState() {
  console.log("Opening Playwright browser...\n");

  // Clean up any leftover auth dir
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });

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

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("https://accounts.google.com");

  await waitForEnter();

  console.log("\nSaving auth state...");

  const storageState = await context.storageState();
  const json = JSON.stringify(storageState, null, 2);
  fs.writeFileSync("google-auth-state.json", json);

  const cookieCount = storageState.cookies.length;
  console.log(`✅ Saved ${cookieCount} cookies to google-auth-state.json`);
  console.log("\nNow upload to Secret Manager:");
  console.log(
    "  gcloud secrets versions add meetingbot-google-auth-state --data-file=google-auth-state.json --project=voiscribe"
  );

  await context.close();
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
}

captureAuthState().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
