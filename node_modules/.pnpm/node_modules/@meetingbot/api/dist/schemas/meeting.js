"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduleMeetingSchema = void 0;
const zod_1 = require("zod");
exports.ScheduleMeetingSchema = zod_1.z.object({
    meetingUrl: zod_1.z
        .string()
        .url()
        .refine((url) => url.startsWith("https://meet.google.com/"), {
        message: "Must be a Google Meet URL (https://meet.google.com/...)",
    }),
    joinAt: zod_1.z
        .string()
        .datetime()
        .refine((dt) => new Date(dt) > new Date(), {
        message: "joinAt must be in the future",
    }),
});
//# sourceMappingURL=meeting.js.map