import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { Readable } from "stream";
import { createLogger } from "@meetingbot/logger";

export type TranscriptChunkEvent = {
  text: string;
  isFinal: boolean;
  timestampMs: number;
  speaker: string;
};

export type DeepgramSession = {
  stop: () => void;
};

const CHUNK_BYTES = 4096;

function dominantSpeakerIndex(words: Array<{ speaker?: number }>): number {
  const counts = new Map<number, number>();
  for (const w of words) {
    if (w.speaker !== undefined) {
      counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
    }
  }
  let best = 0;
  let bestCount = 0;
  for (const [idx, count] of counts) {
    if (count > bestCount) {
      best = idx;
      bestCount = count;
    }
  }
  return best;
}

export function startDeepgramTranscription(
  meetingId: string,
  apiKey: string,
  audioStream: Readable,
  onChunk: (chunk: TranscriptChunkEvent) => Promise<void>,
  getSpeakerName: (speakerIndex: number) => string = (i) => `Speaker ${i}`,
  model = "nova-3",
  language = "multi"
): DeepgramSession {
  const logger = createLogger({ meetingId });
  const deepgram = createClient(apiKey);

  const connection = deepgram.listen.live({
    model,
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
    punctuate: true,
    interim_results: true,
    endpointing: 300,
    language,
    diarize: true,
  });

  const MAX_BUFFER_BYTES = 512 * 1024;
  let buffer = Buffer.alloc(0);

  connection.on(LiveTranscriptionEvents.Open, () => {
    logger.info({ event: "DEEPGRAM_CONNECTED" }, "Deepgram WebSocket opened");
    if (buffer.length > 0) {
      const slice = buffer.subarray(0, buffer.length);
      const ab = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer;
      connection.send(ab);
      buffer = Buffer.alloc(0);
    }
  });

  connection.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const alternative = data?.channel?.alternatives?.[0];
    if (!alternative) return;

    const text = (alternative.transcript ?? "").trim();
    if (!text) return;

    // Resolve speaker name via diarization + Meet UI tracker
    const words: Array<{ speaker?: number }> = alternative.words ?? [];
    const speakerIndex = dominantSpeakerIndex(words);
    const speaker = getSpeakerName(speakerIndex);

    const chunk: TranscriptChunkEvent = {
      text,
      isFinal: data.is_final ?? false,
      timestampMs: Math.round((data.start ?? 0) * 1000),
      speaker,
    };

    logger.debug(
      { event: "TRANSCRIPT_CHUNK", text, speaker, isFinal: chunk.isFinal },
      "Chunk received"
    );

    onChunk(chunk).catch((err) => {
      logger.error({ event: "CHUNK_PERSIST_FAILED", err }, "Failed to persist chunk");
    });
  });

  connection.on(LiveTranscriptionEvents.Error, (err) => {
    logger.error({ event: "DEEPGRAM_ERROR", err }, "Deepgram error");
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    logger.info({ event: "DEEPGRAM_CLOSED" }, "Deepgram WebSocket closed");
  });

  audioStream.on("data", (incoming: Buffer) => {
    buffer = Buffer.concat([buffer, incoming]);
    if (buffer.length > MAX_BUFFER_BYTES) {
      buffer = buffer.subarray(buffer.length - MAX_BUFFER_BYTES);
    }

    while (buffer.length >= CHUNK_BYTES) {
      const slice = buffer.subarray(0, CHUNK_BYTES);
      buffer = buffer.subarray(CHUNK_BYTES);

      if (connection.getReadyState() === 1) {
        connection.send(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer);
      }
    }
  });

  audioStream.on("end", () => {
    logger.info({ event: "AUDIO_STREAM_ENDED" }, "Audio stream ended, closing Deepgram");
    connection.requestClose();
  });

  const stop = (): void => {
    audioStream.destroy();
    connection.requestClose();
    logger.info({ event: "DEEPGRAM_SESSION_STOPPED" }, "Deepgram session stopped");
  };

  return { stop };
}
