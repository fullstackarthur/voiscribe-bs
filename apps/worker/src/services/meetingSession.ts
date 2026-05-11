import { Meeting, getDb } from "@meetingbot/db";
import { createLogger } from "@meetingbot/logger";
import { parseWorkerConfig } from "@meetingbot/config";
import {
  launchAndJoinMeet,
  waitForMeetingEnd,
  cleanupBrowser,
  JoinResult,
} from "../browser/meetJoiner";
import { createSpeakerTracker, SpeakerTracker } from "../browser/speakerTracker";
import { startAudioCapture, AudioPipeline } from "../audio/audioPipeline";
import {
  startDeepgramTranscription,
  TranscriptChunkEvent,
  DeepgramSession,
} from "../transcription/deepgram";

export async function runMeetingSession(meeting: Meeting): Promise<void> {
  const config = parseWorkerConfig();
  const db = getDb();
  const logger = createLogger({ meetingId: meeting.id, workerId: config.workerId });

  logger.info(
    { event: "SESSION_STARTING", meetingUrl: meeting.meetingUrl },
    "Starting meeting session"
  );

  await db.meeting.update({
    where: { id: meeting.id },
    data: { status: "JOINING", startedAt: new Date() },
  });

  let joinResult: JoinResult | undefined;
  let audioPipeline: AudioPipeline | undefined;
  let deepgramSession: DeepgramSession | undefined;
  let speakerTracker: SpeakerTracker | undefined;
  let sessionFailed = false;

  try {
    joinResult = await launchAndJoinMeet(
      meeting.meetingUrl,
      meeting.id,
      config.googleAuthState
    );

    await db.meeting.update({
      where: { id: meeting.id },
      data: { status: "ACTIVE" },
    });

    logger.info({ event: "SESSION_ACTIVE" }, "Meeting session is active");

    speakerTracker = createSpeakerTracker(joinResult.page, meeting.id);

    audioPipeline = startAudioCapture(meeting.id, config.pulseSinkName);

    deepgramSession = startDeepgramTranscription(
      meeting.id,
      config.deepgramApiKey,
      audioPipeline.stream,
      (chunk: TranscriptChunkEvent) => persistChunk(meeting.id, chunk, db),
      (speakerIndex: number) => speakerTracker!.getNameForSpeaker(speakerIndex)
    );

    logger.info({ event: "PIPELINE_RUNNING" }, "Audio and transcription pipeline running");

    await waitForMeetingEnd(joinResult.page, meeting.id);

    logger.info({ event: "MEETING_ENDED" }, "Meeting ended — beginning cleanup");
  } catch (err) {
    sessionFailed = true;
    logger.error({ event: "SESSION_ERROR", err }, "Meeting session failed");

    await db.meeting
      .update({ where: { id: meeting.id }, data: { status: "FAILED" } })
      .catch(() => {});

    throw err;
  } finally {
    speakerTracker?.stop();
    deepgramSession?.stop();
    audioPipeline?.stop();

    if (joinResult) {
      await cleanupBrowser(joinResult, meeting.id);
    }

    if (!sessionFailed) {
      await db.meeting
        .update({
          where: { id: meeting.id },
          data: { status: "ENDED", endedAt: new Date() },
        })
        .catch(() => {});
    }

    logger.info({ event: "SESSION_CLEANUP_COMPLETE" }, "Session cleanup complete");
  }
}

async function persistChunk(
  meetingId: string,
  chunk: TranscriptChunkEvent,
  db: ReturnType<typeof getDb>
): Promise<void> {
  await db.transcriptChunk.create({
    data: {
      meetingId,
      text: chunk.text,
      speaker: chunk.speaker,
      timestampMs: chunk.timestampMs,
      isFinal: chunk.isFinal,
    },
  });
}
