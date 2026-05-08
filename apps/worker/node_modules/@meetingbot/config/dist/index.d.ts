import { z } from "zod";
declare const ApiConfigSchema: z.ZodObject<{
    databaseUrl: z.ZodString;
    cloudTasksProject: z.ZodString;
    cloudTasksLocation: z.ZodString;
    cloudTasksQueue: z.ZodString;
    workerBaseUrl: z.ZodString;
    serviceAccountEmail: z.ZodString;
    port: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    databaseUrl: string;
    cloudTasksProject: string;
    cloudTasksLocation: string;
    cloudTasksQueue: string;
    workerBaseUrl: string;
    serviceAccountEmail: string;
    port: number;
}, {
    databaseUrl: string;
    cloudTasksProject: string;
    cloudTasksLocation: string;
    cloudTasksQueue: string;
    workerBaseUrl: string;
    serviceAccountEmail: string;
    port?: number | undefined;
}>;
declare const WorkerConfigSchema: z.ZodObject<{
    databaseUrl: z.ZodString;
    deepgramApiKey: z.ZodString;
    googleAuthState: z.ZodString;
    pulseSinkName: z.ZodDefault<z.ZodString>;
    port: z.ZodDefault<z.ZodNumber>;
    workerId: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    databaseUrl: string;
    port: number;
    deepgramApiKey: string;
    googleAuthState: string;
    pulseSinkName: string;
    workerId: string;
}, {
    databaseUrl: string;
    deepgramApiKey: string;
    googleAuthState: string;
    port?: number | undefined;
    pulseSinkName?: string | undefined;
    workerId?: string | undefined;
}>;
export type ApiConfig = z.infer<typeof ApiConfigSchema>;
export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;
export declare function parseApiConfig(): ApiConfig;
export declare function parseWorkerConfig(): WorkerConfig;
export {};
//# sourceMappingURL=index.d.ts.map