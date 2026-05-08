import { chromium } from "playwright";
import * as fs from "fs";

async function captureAuthState() {
  console.log("Opening browser. Log in to the bot Google account.");
  console.log("After logging in, navigate to https://meet.google.com");
  console.log("The script saves auth state automatically and exits.\n");

  const context = await chromium.launchPersistentContext("/tmp/auth-setup", {
    headless: false,
    args: ["--no-sandbox"],
  });

  const page = await context.newPage();
  await page.goto("https://accounts.google.com");

  await page.waitForURL("**/meet.google.com**", { timeout: 300_000 });
  console.log("Detected meet.google.com — saving auth state...");

  const storageState = await context.storageState();
  const json = JSON.stringify(storageState);

  fs.writeFileSync("google-auth-state.json", json);
  console.log("Saved to google-auth-state.json");
  console.log("\nUpload to Secret Manager:");
  console.log(
    "  gcloud secrets create meetingbot-google-auth-state \\\n" +
    "    --project=PROJECT_ID \\\n" +
    "    --data-file=google-auth-state.json"
  );

  await context.close();
}

captureAuthState().catch((err) => {
  console.error(err);
  process.exit(1);
});
