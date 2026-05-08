import { z } from "zod";

export const ScheduleMeetingSchema = z.object({
  meetingUrl: z
    .string()
    .url()
    .refine((url) => url.startsWith("https://meet.google.com/"), {
      message: "Must be a Google Meet URL (https://meet.google.com/...)",
    }),
  joinAt: z
    .string()
    .datetime()
    .refine((dt) => new Date(dt) > new Date(), {
      message: "joinAt must be in the future",
    }),
});

export type ScheduleMeetingInput = z.infer<typeof ScheduleMeetingSchema>;
