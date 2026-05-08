import { z } from "zod";

export const WorkerTriggerSchema = z.object({
  meetingId: z.string().uuid(),
});

export type WorkerTriggerInput = z.infer<typeof WorkerTriggerSchema>;
