import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sendTranscriptEmailForMeeting, formatTranscript } from "./transcriptEmail";

const fetchMock = vi.fn();

vi.mock("@meetingbot/logger", () => ({
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatTranscript", () => {
  it("formats final chunks with timestamps and speakers", () => {
    const transcript = formatTranscript([
      {
        timestampMs: 61_000,
        speaker: "Arjun",
        text: "Hello team.",
      },
      {
        timestampMs: 3_661_000,
        speaker: "Speaker 1",
        text: "Let's begin.",
      },
    ] as any);

    expect(transcript).toBe(
      ["[00:01:01] Arjun: Hello team.", "[01:01:01] Speaker 1: Let's begin."].join("\n")
    );
  });
});

describe("sendTranscriptEmailForMeeting", () => {
  it("sends final transcript chunks through Gmail API", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
      });

    const db = {
      transcriptChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            timestampMs: 0,
            speaker: "Arjun",
            text: "This is the final transcript.",
          },
        ]),
      },
    };

    await sendTranscriptEmailForMeeting("meeting-id", db as any, {
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      senderEmail: "bot@example.com",
      recipientEmail: "arjhnpr@gmail.com",
    });

    expect(db.transcriptChunk.findMany).toHaveBeenCalledWith({
      where: { meetingId: "meeting-id", isFinal: true },
      orderBy: [{ timestampMs: "asc" }, { createdAt: "asc" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
      },
    });
  });

  it("skips sending when Gmail settings are incomplete", async () => {
    const db = {
      transcriptChunk: {
        findMany: vi.fn(),
      },
    };

    await sendTranscriptEmailForMeeting("meeting-id", db as any, {
      recipientEmail: "arjhnpr@gmail.com",
    });

    expect(db.transcriptChunk.findMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
