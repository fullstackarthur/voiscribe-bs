import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { workerPlugin } from "./index";

vi.mock("./services/meetingSession", () => ({
  runMeetingSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@meetingbot/db", () => {
  const mockMeeting = {
    id: "meeting-uuid",
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    status: "SCHEDULED",
    joinAt: new Date(),
    startedAt: null,
    endedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    getDb: vi.fn().mockReturnValue({
      meeting: {
        findUnique: vi.fn().mockResolvedValue(mockMeeting),
      },
    }),
  };
});

describe("POST /run", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    await app.register(workerPlugin);
  });

  it("returns 200 and starts session for valid trigger", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/run",
      payload: { meetingId: "550e8400-e29b-41d4-a716-446655440000" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("started");
  });

  it("returns 400 when meetingId is not a UUID", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/run",
      payload: { meetingId: "not-a-uuid" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/run",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 404 when meeting does not exist in DB", async () => {
    const { getDb } = await import("@meetingbot/db");
    vi.mocked(getDb).mockReturnValueOnce({
      meeting: { findUnique: vi.fn().mockResolvedValue(null) },
    } as any);

    const response = await app.inject({
      method: "POST",
      url: "/run",
      payload: { meetingId: "550e8400-e29b-41d4-a716-446655440000" },
    });

    expect(response.statusCode).toBe(404);
  });
});
