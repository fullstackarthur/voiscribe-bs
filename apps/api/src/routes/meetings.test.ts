import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { meetingsPlugin } from "./meetings";

vi.mock("../services/scheduler", () => ({
  scheduleMeeting: vi.fn().mockResolvedValue({ id: "uuid-123" }),
}));

describe("POST /meetings/schedule", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(meetingsPlugin);
  });

  it("returns 201 with meetingId for a valid request", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/meetings/schedule",
      payload: {
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        joinAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.meetingId).toBe("uuid-123");
  });

  it("returns 400 for a non-Meet URL", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/meetings/schedule",
      payload: {
        meetingUrl: "https://zoom.us/j/123456789",
        joinAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when joinAt is in the past", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/meetings/schedule",
      payload: {
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        joinAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/meetings/schedule",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});
