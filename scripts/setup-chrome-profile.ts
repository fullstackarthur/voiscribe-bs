/**
 * Creates or refreshes a persistent Chrome profile for the meeting bot.
 *
 * Usage:
 *   CHROME_USER_DATA_DIR=./tmp/bot-chrome-profile pnpm setup:chrome-profile
 *
 * Sign into the bot Google account in the opened browser, then press Enter.
 * The profile directory can be mounted into the worker at the same path used
 * by CHROME_USER_DATA_DIR inside the container.
 */
import { chromium } from "playwright";
import * as path from "path";
import * as readline from "readline";

const profileDir = path.resolve(
  process.env["CHROME_USER_DATA_DIR"] ?? "./tmp/bot-chrome-profile"
);

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    process.stdout.write(
      "\n>>> Sign into the bot Google account in the browser, then press ENTER here to close and save the profile: "
    );
    rl.once("line", () => {
      rl.close();
      resolve();
    });
  });
}

async function setupChromeProfile(): Promise<void> {
  console.log(`Opening persistent Chrome profile at: ${profileDir}\n`);

  const context = await chromium.launchPersistentContext(profileDir, {
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
  await context.close();

  console.log("\nChrome profile saved.");
  console.log(`Mount this host directory into the worker and set CHROME_USER_DATA_DIR inside the container.`);
  console.log(`Host profile dir: ${profileDir}`);
}

setupChromeProfile().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
