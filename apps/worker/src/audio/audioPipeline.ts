import { spawn, ChildProcess } from "child_process";
import { Readable } from "stream";
import { createLogger } from "@meetingbot/logger";

export type AudioPipeline = {
  stream: Readable;
  stop: () => void;
};

export function startAudioCapture(
  meetingId: string,
  pulseSinkName: string
): AudioPipeline {
  const logger = createLogger({ meetingId });
  const monitorSource = `${pulseSinkName}.monitor`;

  logger.info(
    { event: "AUDIO_PIPELINE_STARTING", monitorSource },
    "Starting FFmpeg audio capture"
  );

  const ffmpeg: ChildProcess = spawn(
    "ffmpeg",
    [
      "-f", "pulse",
      "-i", monitorSource,
      "-ac", "1",       // mono
      "-ar", "16000",   // 16 kHz
      "-f", "s16le",    // Linear16 PCM
      "pipe:1",         // write to stdout
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  ffmpeg.stderr?.on("data", (chunk: Buffer) => {
    logger.debug({ event: "FFMPEG_STDERR", msg: chunk.toString() }, "FFmpeg");
  });

  ffmpeg.on("error", (err) => {
    logger.error({ event: "FFMPEG_ERROR", err }, "FFmpeg process error");
  });

  ffmpeg.on("exit", (code, signal) => {
    logger.info({ event: "FFMPEG_EXITED", code, signal }, "FFmpeg process exited");
  });

  const stream = ffmpeg.stdout as Readable;

  const stop = (): void => {
    logger.info({ event: "AUDIO_PIPELINE_STOPPING" }, "Killing FFmpeg");
    ffmpeg.kill("SIGTERM");
  };

  return { stream, stop };
}
