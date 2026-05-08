"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseApiConfig = parseApiConfig;
exports.parseWorkerConfig = parseWorkerConfig;
const zod_1 = require("zod");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const ApiConfigSchema = zod_1.z.object({
    databaseUrl: zod_1.z.string().url(),
    cloudTasksProject: zod_1.z.string().min(1),
    cloudTasksLocation: zod_1.z.string().min(1),
    cloudTasksQueue: zod_1.z.string().min(1),
    workerBaseUrl: zod_1.z.string().url(),
    serviceAccountEmail: zod_1.z.string().email(),
    port: zod_1.z.coerce.number().default(3000),
});
const WorkerConfigSchema = zod_1.z.object({
    databaseUrl: zod_1.z.string().url(),
    deepgramApiKey: zod_1.z.string().min(1),
    googleAuthState: zod_1.z.string().min(1),
    pulseSinkName: zod_1.z.string().default("virtual_sink"),
    port: zod_1.z.coerce.number().default(3001),
    workerId: zod_1.z.string().default(() => `worker-${Date.now()}`),
});
function parseApiConfig() {
    return ApiConfigSchema.parse({
        databaseUrl: process.env["DATABASE_URL"],
        cloudTasksProject: process.env["CLOUD_TASKS_PROJECT"],
        cloudTasksLocation: process.env["CLOUD_TASKS_LOCATION"],
        cloudTasksQueue: process.env["CLOUD_TASKS_QUEUE"],
        workerBaseUrl: process.env["WORKER_BASE_URL"],
        serviceAccountEmail: process.env["SERVICE_ACCOUNT_EMAIL"],
        port: process.env["PORT"],
    });
}
function parseWorkerConfig() {
    return WorkerConfigSchema.parse({
        databaseUrl: process.env["DATABASE_URL"],
        deepgramApiKey: process.env["DEEPGRAM_API_KEY"],
        googleAuthState: process.env["GOOGLE_AUTH_STATE"],
        pulseSinkName: process.env["PULSE_SINK_NAME"],
        port: process.env["PORT"],
        workerId: process.env["WORKER_ID"],
    });
}
//# sourceMappingURL=index.js.map