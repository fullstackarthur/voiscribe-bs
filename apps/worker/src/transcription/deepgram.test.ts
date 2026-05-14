import { describe, expect, it, vi } from "vitest";
import { Readable } from "stream";
import { startDeepgramTranscription } from "./deepgram";

const liveOptions: unknown[] = [];

vi.mock("@deepgram/sdk", () => ({
  LiveTranscriptionEvents: {
    Open: "open",
    Transcript: "transcript",
    Error: "error",
    Close: "close",
  },
  createClient: vi.fn(() => ({
    listen: {
      live: vi.fn((options) => {
        liveOptions.push(options);
        return {
          on: vi.fn(),
          send: vi.fn(),
          requestClose: vi.fn(),
          getReadyState: vi.fn(() => 1),
        };
      }),
    },
  })),
}));

vi.mock("@meetingbot/logger", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
}));

describe("startDeepgramTranscription", () => {
  it("uses Nova-3 multilingual transcription by default", () => {
    liveOptions.length = 0;

    const session = startDeepgramTranscription(
      "meeting-id",
      "dg-key",
      Readable.from([]),
      vi.fn()
    );

    expect(liveOptions[0]).toMatchObject({
      model: "nova-3",
      language: "multi",
      diarize: true,
      interim_results: true,
    });

    session.stop();
  });

  it("allows deployment-specific Deepgram model and language overrides", () => {
    liveOptions.length = 0;

    const session = startDeepgramTranscription(
      "meeting-id",
      "dg-key",
      Readable.from([]),
      vi.fn(),
      undefined,
      "nova-2",
      "hi"
    );

    expect(liveOptions[0]).toMatchObject({
      model: "nova-2",
      language: "hi",
    });

    session.stop();
  });
});
