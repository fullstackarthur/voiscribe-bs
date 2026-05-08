import { chromium, BrowserContext, Page } from "playwright";
import { createLogger } from "@meetingbot/logger";
import * as fs from "fs";

export type JoinResult = {
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

  logger.info({ event: "BROWSER_LAUNCHING" }, "Launching Chromium");

  const context = await chromium.launchPersistentContext(
    `/tmp/browser-data-${meetingId}`,
    {
      headless: false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--use-fake-ui-for-media-stream",
        "--disable-dev-shm-usage",
        "--disable-features=VizDisplayCompositor",
        `--display=${process.env["DISPLAY"] ?? ":99"}`,
      ],
      permissions: ["camera", "microphone"],
      ignoreDefaultArgs: ["--mute-audio"],
    }
  );

  fs.writeFileSync(authStatePath, googleAuthStateJson);
  try {
    await context.setStorageState(authStatePath);
  } finally {
    fs.rmSync(authStatePath, { force: true });
  }

  const page = await context.newPage();

  logger.info({ event: "NAVIGATING_TO_MEET", meetingUrl }, "Navigating to Meet URL");
  await page.goto(meetingUrl, { waitUntil: "domcontentloaded" });

  await disableCameraAndMic(page, logger);
  await clickJoinButton(page, logger);

  logger.info({ event: "WAITING_FOR_ADMISSION" }, "Waiting for meeting admission");
  await waitUntilInMeeting(page, logger);

  logger.info({ event: "MEETING_JOINED" }, "Bot has joined the meeting");

  return { context, page };
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
  context: BrowserContext,
  meetingId: string
): Promise<void> {
  const logger = createLogger({ meetingId });

  try {
    await context.close();
    logger.info({ event: "BROWSER_CLOSED" }, "Browser context closed");
  } catch (err) {
    logger.warn({ event: "BROWSER_CLOSE_FAILED", err }, "Failed to close browser gracefully");
  }

  fs.rmSync(`/tmp/browser-data-${meetingId}`, { recursive: true, force: true });
}
