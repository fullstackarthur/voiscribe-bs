import pino from "pino";
export type LoggerContext = {
    meetingId?: string;
    workerId?: string;
    [key: string]: string | undefined;
};
export declare function createLogger(context: LoggerContext): pino.Logger;
export type Logger = pino.Logger;
//# sourceMappingURL=index.d.ts.map