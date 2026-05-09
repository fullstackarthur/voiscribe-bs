import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createLogger } from "@meetingbot/logger";
import * as fs from "fs";

export type JoinResult = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

const JOIN_TIMEOUT_MS = 120_000;
const MEETING_END_POLL_MS = 5_000;

export async function launchAndJoinMeet(
  meetingUrl: string,
  meetingId: string,
  googleAuthStateJson: string
): Promise<JoinResult> {
  const logger = createLogger({ meetingId });

  const authStatePath = `/tmp/auth-state-${meetingId}.json`;
  fs.writeFileSync(authStatePath, googleAuthStateJson);

  logger.info({ event: "BROWSER_LAUNCHING" }, "Launching Chromium");

  // Launch browser first (no storageState here)
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-fake-ui-for-media-stream",
      "--disable-dev-shm-usage",
      "--disable-features=VizDisplayCompositor",
      `--display=${process.env["DISPLAY"] ?? ":99"}`,
    ],
  });

  // Create context WITH storageState so cookies are loaded before any navigation
  const context = await browser.newContext({
    storageState: authStatePath,
    permissions: ["camera", "microphone"],
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  fs.rmSync(authStatePath, { force: true });

  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      logger.warn({ event: "BROWSER_CONSOLE_ERROR", text: msg.text() }, "Browser console error");
    }
  });

  logger.info({ event: "NAVIGATING_TO_MEET", meetingUrl }, "Navigating to Meet URL");
  await page.goto(meetingUrl, { waitUntil: "domcontentloaded" });

  const pageUrl = page.url();
  const pageTitle = await page.title().catch(() => "unknown");
  const pageText = await page.innerText("body").catch(() => "could not extract body text");
  logger.info(
    { event: "PAGE_LOADED", pageUrl, pageTitle, pageText: pageText.slice(0, 3000) },
    "Page loaded after navigation"
  );

  await disableCameraAndMic(page, logger);
  await clickJoinButton(page, logger);

  const urlAfterJoin = page.url();
  const textAfterJoin = await page.innerText("body").catch(() => "could not extract body text");
  logger.info(
    { event: "URL_AFTER_JOIN", urlAfterJoin, pageText: textAfterJoin.slice(0, 3000) },
    "URL after clicking join"
  );

  logger.info({ event: "WAITING_FOR_ADMISSION" }, "Waiting for meeting admission");
  await waitUntilInMeeting(page, logger);

  logger.info({ event: "MEETING_JOINED" }, "Bot has joined the meeting");

  return { browser, context, page };
}

async function disableCameraAndMic(
  page: Page,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  for (const { label, selectors } of [
    {
      label: "camera",
      selectors: ['[data-tooltip*="camera" i]', '[aria-label*="camera" i]'],
    },
    {
      label: "microphone",
      selectors: ['[data-tooltip*="microphone" i]', '[aria-label*="microphone" i]'],
    },
  ]) {
    for (const selector of selectors) {
      try {
        await page.click(selector, { timeout: 4_000 });
        logger.info({ event: `${label.toUpperCase()}_DISABLED` }, `${label} disabled`);
        break;
      } catch {
        // try next selector
      }
    }
  }
}

async function clickJoinButton(
  page: Page,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  logger.info({ event: "CLICKING_JOIN" }, "Looking for join button");

  const candidates = [
    'button:has-text("Join now")',
    'button:has-text("Ask to join")',
    'button:has-text("Join")',
    '[jsname="Qx7uuf"]',
  ];

  for (const selector of candidates) {
    try {
      await page.click(selector, { timeout: 5_000 });
      logger.info({ event: "JOIN_CLICKED", selector }, "Join button clicked");
      return;
    } catch {
      // try next
    }
  }

  throw new Error("Could not find and click a join button — selectors exhausted");
}

async function waitUntilInMeeting(
  page: Page,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  const deadline = Date.now() + JOIN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const admitted = await page
      .locator('[data-participant-id], [jsname="r4nke"], [jsname="HlFzId"]')
      .count()
      .catch(() => 0);

    if (admitted > 0) return;

    const waiting = await page
      .locator(':text("waiting to be let in"), :text("Waiting for host")')
      .count()
      .catch(() => 0);

    if (waiting > 0) {
      logger.info({ event: "WAITING_FOR_HOST" }, "Waiting to be admitted by host");
    }

    await page.waitForTimeout(2_000);
  }

  throw new Error(`Meeting did not start within ${JOIN_TIMEOUT_MS / 1000}s`);
}

export async function waitForMeetingEnd(page: Page, meetingId: string): Promise<void> {
  const logger = createLogger({ meetingId });

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      try {
        const ended = await page
          .locator(
            ':text("You left the meeting"), :text("The call has ended"), [data-call-ended]'
          )
          .count()
          .catch(() => 0);

        if (ended > 0 || page.isClosed()) {
          logger.info({ event: "MEETING_END_DETECTED" }, "Meeting end detected");
          clearInterval(interval);
          resolve();
        }
      } catch {
        clearInterval(interval);
        resolve();
      }
    }, MEETING_END_POLL_MS);
  });
}

export async function cleanupBrowser(
  joinResult: JoinResult,
  meetingId: string
): Promise<void> {
  const logger = createLogger({ meetingId });

  try {
    await joinResult.context.close();
    await joinResult.browser.close();
    logger.info({ event: "BROWSER_CLOSED" }, "Browser context closed");
  } catch (err) {
    logger.warn({ event: "BROWSER_CLOSE_FAILED", err }, "Failed to close browser gracefully");
  }
}
