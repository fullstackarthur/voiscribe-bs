import { PrismaClient } from "@prisma/client";

let client: PrismaClient | undefined;

export function getDb(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      log: [
        { level: "error", emit: "stdout" },
        { level: "warn", emit: "stdout" },
      ],
    });
  }
  return client;
}

export type { Meeting, TranscriptChunk, MeetingStatus } from "@prisma/client";
