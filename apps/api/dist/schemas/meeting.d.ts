import { z } from "zod";
export declare const ScheduleMeetingSchema: z.ZodObject<{
    meetingUrl: z.ZodEffects<z.ZodString, string, string>;
    joinAt: z.ZodEffects<z.ZodString, string, string>;
}, "strip", z.ZodTypeAny, {
    meetingUrl: string;
    joinAt: string;
}, {
    meetingUrl: string;
    joinAt: string;
}>;
export type ScheduleMeetingInput = z.infer<typeof ScheduleMeetingSchema>;
//# sourceMappingURL=meeting.d.ts.map