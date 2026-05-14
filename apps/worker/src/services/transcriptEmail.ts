import { PrismaClient, TranscriptChunk } from "@prisma/client";
import { createLogger } from "@meetingbot/logger";

export type GmailTranscriptEmailConfig = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  senderEmail?: string;
  recipientEmail: string;
};

type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export async function sendTranscriptEmailForMeeting(
  meetingId: string,
  db: PrismaClient,
  config: GmailTranscriptEmailConfig
): Promise<void> {
  const logger = createLogger({ meetingId });

  if (!isGmailConfigured(config)) {
    logger.warn(
      { event: "TRANSCRIPT_EMAIL_SKIPPED" },
      "Gmail email settings are incomplete; transcript email skipped"
    );
    return;
  }

  const chunks = await db.transcriptChunk.findMany({
    where: { meetingId, isFinal: true },
    orderBy: [{ timestampMs: "asc" }, { createdAt: "asc" }],
  });

  const transcript = formatTranscript(chunks);
  if (!transcript) {
    logger.warn(
      { event: "TRANSCRIPT_EMAIL_SKIPPED_EMPTY" },
      "No final transcript chunks found; transcript email skipped"
    );
    return;
  }

  const subject = `Meeting transcript ${meetingId}`;
  const body = [
    "Transcript",
    "",
    `Meeting ID: ${meetingId}`,
    "",
    transcript,
  ].join("\n");

  await sendGmailMessage(config, {
    to: config.recipientEmail,
    from: config.senderEmail!,
    subject,
    body,
  });

  logger.info(
    { event: "TRANSCRIPT_EMAIL_SENT", recipientEmail: config.recipientEmail },
    "Transcript email sent"
  );
}

export function formatTranscript(chunks: TranscriptChunk[]): string {
  return chunks
    .map((chunk) => {
      const timestamp = formatTimestamp(chunk.timestampMs);
      return `[${timestamp}] ${chunk.speaker}: ${chunk.text}`;
    })
    .join("\n")
    .trim();
}

function isGmailConfigured(config: GmailTranscriptEmailConfig): boolean {
  return Boolean(
    config.clientId &&
      config.clientSecret &&
      config.refreshToken &&
      config.senderEmail &&
      config.recipientEmail
  );
}

function formatTimestamp(timestampMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => part.toString().padStart(2, "0"))
    .join(":");
}

async function sendGmailMessage(
  config: GmailTranscriptEmailConfig,
  message: { to: string; from: string; subject: string; body: string }
): Promise<void> {
  const accessToken = await getAccessToken(config);
  const raw = encodeBase64Url(buildMimeMessage(message));

  const response = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail send failed: ${response.status} ${text}`);
  }
}

async function getAccessToken(config: GmailTranscriptEmailConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId!,
    client_secret: config.clientSecret!,
    refresh_token: config.refreshToken!,
    grant_type: "refresh_token",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = (await response.json()) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Gmail token refresh failed: ${payload.error_description ?? payload.error ?? response.status}`
    );
  }

  return payload.access_token;
}

function buildMimeMessage(message: {
  to: string;
  from: string;
  subject: string;
  body: string;
}): string {
  return [
    `To: ${message.to}`,
    `From: ${message.from}`,
    `Subject: ${encodeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    message.body,
  ].join("\r\n");
}

function encodeHeader(value: string): string {
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
