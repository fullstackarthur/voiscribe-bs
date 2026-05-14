import { CloudTasksClient, protos } from "@google-cloud/tasks";
import { getDb } from "@meetingbot/db";
import { createLogger } from "@meetingbot/logger";
import { parseApiConfig, ApiConfig } from "@meetingbot/config";
import { ScheduleMeetingInput } from "../schemas/meeting";

const logger = createLogger({});
const tasksClient = new CloudTasksClient();

export async function scheduleMeeting(
  input: ScheduleMeetingInput
): Promise<{ id: string }> {
  const config = parseApiConfig();
  const db = getDb();

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

async function enqueueCloudTask(
  meetingId: string,
  joinAt: Date,
  config: ApiConfig
): Promise<void> {
  const parent = tasksClient.queuePath(
    config.cloudTasksProject,
    config.cloudTasksLocation,
    config.cloudTasksQueue
  );

  const task: protos.google.cloud.tasks.v2.ITask = {
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

  await tasksClient.createTask({ parent, task });
}
