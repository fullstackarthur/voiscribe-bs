import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createLogger } from "@meetingbot/logger";

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
  googleEmail: string,
  googleAppPassword: string
): Promise<JoinResult> {
  const logger = createLogger({ meetingId });

  logger.info({ event: "BROWSER_LAUNCHING" }, "Launching Chromium");

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-fake-ui-for-media-stream",
      "--disable-dev-shm-usage",
      "--disable-features=VizDisplayCompositor",
      "--disable-blink-features=AutomationControlled",
      `--display=${process.env["DISPLAY"] ?? ":99"}`,
    ],
  });

  const context = await browser.newContext({
    permissions: ["camera", "microphone"],
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  // Hide automation signals so Google doesn't block the session
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      logger.warn({ event: "BROWSER_CONSOLE_ERROR", text: msg.text() }, "Browser console error");
    }
  });

  // Sign into Google first
  await signInWithCredentials(page, googleEmail, googleAppPassword, logger);

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

async function signInWithCredentials(
  page: Page,
  email: string,
  appPassword: string,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  logger.info({ event: "GOOGLE_SIGNIN_START" }, "Signing into Google with credentials");

  await page.goto("https://accounts.google.com/signin/v2/identifier", {
    waitUntil: "domcontentloaded",
  });

  // Enter email
  try {
    const emailInput = page.locator('input[type="email"]').first();
    await emailInput.waitFor({ state: "visible", timeout: 15_000 });
    await emailInput.click();
    await emailInput.type(email, { delay: 50 });
    await page.waitForTimeout(500);
    // Click the visible Next button by ID
    await page.locator('#identifierNext').click();
    logger.info({ event: "GOOGLE_EMAIL_ENTERED" }, "Email entered and Next clicked");
  } catch (err) {
    const bodyText = await page.innerText("body").catch(() => "");
    logger.warn({ event: "GOOGLE_EMAIL_FAILED", bodyText: bodyText.slice(0, 500), err }, "Could not enter email");
    throw new Error(`Google sign-in failed at email step: ${err}`);
  }

  // Wait for password page to fully load after email submission
  try {
    await page.waitForSelector('input[name="Passwd"]', { timeout: 15_000, state: "visible" });
    await page.waitForTimeout(800);
  } catch (err) {
    const bodyText = await page.innerText("body").catch(() => "");
    logger.warn({ event: "GOOGLE_PASSWORD_PAGE_FAILED", bodyText: bodyText.slice(0, 500), err }, "Password page did not appear");
    throw new Error(`Google sign-in failed waiting for password page: ${err}`);
  }

  // Enter password (App Password — bypasses 2FA)
  try {
    const passwordInput = page.locator('input[name="Passwd"]').first();
    await passwordInput.click();
    await passwordInput.type(appPassword, { delay: 50 });
    await page.waitForTimeout(500);
    await page.locator('#passwordNext').click();
    logger.info({ event: "GOOGLE_PASSWORD_ENTERED" }, "App password entered and Next clicked");
  } catch (err) {
    logger.warn({ event: "GOOGLE_PASSWORD_FAILED", err }, "Could not enter password");
    throw new Error(`Google sign-in failed at password step: ${err}`);
  }

  // Wait for redirect away from accounts.google.com (sign-in complete)
  try {
    await page.waitForFunction(
      () => !window.location.hostname.includes("accounts.google.com"),
      { timeout: 20_000 }
    );
    logger.info({ event: "GOOGLE_SIGNIN_COMPLETE" }, "Google sign-in complete");
  } catch {
    const url = page.url();
    const bodyText = await page.innerText("body").catch(() => "");
    logger.warn(
      { event: "GOOGLE_SIGNIN_TIMEOUT", url, bodyText: bodyText.slice(0, 1000) },
      "Sign-in redirect timed out — continuing anyway"
    );
    // If still on password page, the password was rejected — abort
    if (url.includes("accounts.google.com")) {
      throw new Error(`Google sign-in failed — still on accounts.google.com after password. Body: ${bodyText.slice(0, 300)}`);
    }
  }
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
