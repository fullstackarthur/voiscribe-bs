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

export function startDeepgramTranscription(
  meetingId: string,
  apiKey: string,
  audioStream: Readable,
  onChunk: (chunk: TranscriptChunkEvent) => Promise<void>
): DeepgramSession {
  const logger = createLogger({ meetingId });
  const deepgram = createClient(apiKey);

  const connection = deepgram.listen.live({
    model: "nova-2",
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
    punctuate: true,
    interim_results: true,
    endpointing: 300,
    language: "en",
  });

  // Buffer audio and send in fixed-size chunks
  const MAX_BUFFER_BYTES = 512 * 1024; // 512 KB
  let buffer = Buffer.alloc(0);

  connection.on(LiveTranscriptionEvents.Open, () => {
    logger.info({ event: "DEEPGRAM_CONNECTED" }, "Deepgram WebSocket opened");
    // drain any pre-buffered audio
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

    const chunk: TranscriptChunkEvent = {
      text,
      isFinal: data.is_final ?? false,
      timestampMs: Math.round((data.start ?? 0) * 1000),
      speaker: "unknown",
    };

    logger.debug({ event: "TRANSCRIPT_CHUNK", text, isFinal: chunk.isFinal }, "Chunk received");

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
