import { Page } from "playwright";
import { createLogger } from "@meetingbot/logger";

export type SpeakerTracker = {
  getNameForSpeaker: (speakerIndex: number) => string;
  stop: () => void;
};

/**
 * Polls Google Meet's DOM every second to detect who is currently speaking.
 * Maps Deepgram speaker indices to actual participant names from the Meet UI.
 */
export function createSpeakerTracker(page: Page, meetingId: string): SpeakerTracker {
  const logger = createLogger({ meetingId });
  const speakerMap = new Map<number, string>(); // speakerIndex -> resolved name
  let currentSpeakerName: string | null = null;
  let stopped = false;

  let pollCount = 0;

  async function poll() {
    while (!stopped) {
      try {
        const name = await getActiveSpeakerName(page);
        if (name && name !== currentSpeakerName) {
          currentSpeakerName = name;
          logger.info({ event: "ACTIVE_SPEAKER_DETECTED", name }, "Active speaker detected");
        }

        // Every 10s dump DOM snapshot for selector debugging
        if (pollCount % 10 === 0) {
          const snapshot = await page.evaluate((): string => {
            const tiles = Array.from(document.querySelectorAll("[data-participant-id]"));
            const tileInfo = tiles.map((t) => ({
              id: t.getAttribute("data-participant-id"),
              attrs: Array.from(t.attributes).map((a) => `${a.name}=${a.value}`).join(" "),
              children: Array.from(t.querySelectorAll("*"))
                .filter((el) => el.textContent?.trim())
                .slice(0, 5)
                .map((el) => `<${el.tagName.toLowerCase()} jsname="${el.getAttribute("jsname")}">${el.textContent?.trim()?.slice(0, 40)}</${el.tagName.toLowerCase()}>`)
                .join(", "),
            }));
            return JSON.stringify(tileInfo);
          }).catch(() => "eval failed");
          logger.info({ event: "DOM_SNAPSHOT", snapshot }, "Speaker tracker DOM snapshot");
        }
        pollCount++;
      } catch {
        // page may be closing — ignore
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  poll();

  return {
    getNameForSpeaker: (speakerIndex: number): string => {
      // If we already resolved this speaker index, return cached name
      if (speakerMap.has(speakerIndex)) {
        return speakerMap.get(speakerIndex)!;
      }
      // Correlate current Meet UI active speaker with this Deepgram speaker index
      if (currentSpeakerName) {
        speakerMap.set(speakerIndex, currentSpeakerName);
        logger.info(
          { event: "SPEAKER_MAPPED", speakerIndex, name: currentSpeakerName },
          "Mapped Deepgram speaker index to name"
        );
        return currentSpeakerName;
      }
      return `Speaker ${speakerIndex}`;
    },
    stop: () => {
      stopped = true;
    },
  };
}

async function getActiveSpeakerName(page: Page): Promise<string | null> {
  return page
    .evaluate((): string | null => {
      // Strategy 1: participant tile with a visible audio/speaking indicator
      const tiles = Array.from(document.querySelectorAll("[data-participant-id]")) as Element[];
      for (const tile of tiles) {
        const hasSpeakingIndicator =
          tile.querySelector("[jsname='EjAkre']") ||
          tile.querySelector("[jsname='Zf6De']") ||
          tile.getAttribute("data-is-speaking") === "true";

        if (hasSpeakingIndicator) {
          const nameSelectors = [
            "[jsname='Q4dMec']",
            "[jsname='r4nke']",
            ".ZjFb7c",
            "[data-tooltip-id]",
          ];
          for (const sel of nameSelectors) {
            const el = tile.querySelector(sel);
            const name = el?.textContent?.trim();
            if (name && name.length > 0 && name.length < 100) return name;
          }
        }
      }

      // Strategy 2: featured/dominant speaker tile name
      const featuredSelectors = [
        "[jsname='HlFzId'] [jsname='Q4dMec']",
        "[jsname='r4nke'] [jsname='Q4dMec']",
      ];
      for (const sel of featuredSelectors) {
        const el = document.querySelector(sel);
        const name = el?.textContent?.trim();
        if (name && name.length > 0 && name.length < 100) return name;
      }

      // Strategy 3: aria-label on the active speaker element
      const ariaEl = document.querySelector("[aria-label*='speaking']");
      if (ariaEl) {
        const label = ariaEl.getAttribute("aria-label") ?? "";
        const match = label.match(/^(.+?)\s+is speaking/i);
        if (match?.[1]) return match[1];
      }

      return null;
    })
    .catch(() => null);
}
