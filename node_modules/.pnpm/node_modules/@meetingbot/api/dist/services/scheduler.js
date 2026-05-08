"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleMeeting = scheduleMeeting;
const tasks_1 = require("@google-cloud/tasks");
const db_1 = require("@meetingbot/db");
const logger_1 = require("@meetingbot/logger");
const config_1 = require("@meetingbot/config");
const logger = (0, logger_1.createLogger)({});
async function scheduleMeeting(input) {
    const config = (0, config_1.parseApiConfig)();
    const db = (0, db_1.getDb)();
    const meeting = await db.meeting.create({
        data: {
            meetingUrl: input.meetingUrl,
            joinAt: new Date(input.joinAt),
            status: "SCHEDULED",
        },
    });
    const log = logger.child({ meetingId: meeting.id });
    log.info({ event: "MEETING_CREATED", joinAt: input.joinAt }, "Meeting created in DB");
    await enqueueCloudTask(meeting.id, new Date(input.joinAt), config);
    log.info({ event: "CLOUD_TASK_ENQUEUED" }, "Cloud Task scheduled");
    return { id: meeting.id };
}
async function enqueueCloudTask(meetingId, joinAt, config) {
    const client = new tasks_1.CloudTasksClient();
    const parent = client.queuePath(config.cloudTasksProject, config.cloudTasksLocation, config.cloudTasksQueue);
    const task = {
        scheduleTime: {
            seconds: Math.floor(joinAt.getTime() / 1000),
        },
        httpRequest: {
            httpMethod: "POST",
            url: `${config.workerBaseUrl}/run`,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(JSON.stringify({ meetingId })).toString("base64"),
            oidcToken: { serviceAccountEmail: config.serviceAccountEmail },
        },
    };
    await client.createTask({ parent, task });
}
//# sourceMappingURL=scheduler.js.map