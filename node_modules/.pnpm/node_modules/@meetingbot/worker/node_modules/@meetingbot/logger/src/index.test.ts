import { describe, it, expect } from "vitest";
import { createLogger } from "./index";

describe("createLogger", () => {
  it("returns a logger with info/error/warn methods", () => {
    const logger = createLogger({ meetingId: "test-123", workerId: "w-1" });
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
  });

  it("accepts empty context without throwing", () => {
    const logger = createLogger({});
    expect(typeof logger.info).toBe("function");
  });

  it("accepts partial context (meetingId only)", () => {
    const logger = createLogger({ meetingId: "meeting-abc" });
    expect(typeof logger.info).toBe("function");
  });
});
