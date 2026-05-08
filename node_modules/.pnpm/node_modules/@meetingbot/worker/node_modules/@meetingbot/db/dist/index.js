"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
const client_1 = require("@prisma/client");
let client;
function getDb() {
    if (!client) {
        client = new client_1.PrismaClient({
            log: [
                { level: "error", emit: "stdout" },
                { level: "warn", emit: "stdout" },
            ],
        });
    }
    return client;
}
//# sourceMappingURL=index.js.map