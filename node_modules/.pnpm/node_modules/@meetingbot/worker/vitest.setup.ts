// Set up minimum environment variables needed for config parsing during tests
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
}
if (!process.env.DEEPGRAM_API_KEY) {
  process.env.DEEPGRAM_API_KEY = "test_key";
}
if (!process.env.GOOGLE_AUTH_STATE) {
  process.env.GOOGLE_AUTH_STATE = "test_state";
}
if (!process.env.PORT) {
  process.env.PORT = "3000";
}
if (!process.env.WORKER_ID) {
  process.env.WORKER_ID = "test_worker";
}
