/**
 * One-time Gmail OAuth setup for transcript emails.
 *
 * Required env:
 *   GMAIL_CLIENT_ID
 *   GMAIL_CLIENT_SECRET
 *
 * Usage:
 *   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... pnpm setup:gmail-oauth
 */
import * as http from "http";

const clientId = process.env["GMAIL_CLIENT_ID"];
const clientSecret = process.env["GMAIL_CLIENT_SECRET"];
const port = Number(process.env["GMAIL_OAUTH_PORT"] ?? 3333);
const redirectUri = `http://localhost:${port}/oauth2callback`;
const scope = "https://www.googleapis.com/auth/gmail.send";

if (!clientId || !clientSecret) {
  console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET before running this script.");
  process.exit(1);
}

async function exchangeCodeForTokens(code: string): Promise<Record<string, unknown>> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(JSON.stringify(payload, null, 2));
  }

  return payload;
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", scope);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url ?? "/", redirectUri);
    const code = requestUrl.searchParams.get("code");
    const error = requestUrl.searchParams.get("error");

    if (error) {
      throw new Error(error);
    }

    if (!code) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const tokens = await exchangeCodeForTokens(code);
    const refreshToken = tokens["refresh_token"];

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Gmail OAuth complete. You can close this tab.");

    if (!refreshToken) {
      console.log("\nNo refresh token returned. Re-run with prompt=consent or revoke prior app access.");
      console.log(JSON.stringify(tokens, null, 2));
    } else {
      console.log("\nAdd these to the worker environment or Secret Manager:");
      console.log(`GMAIL_CLIENT_ID=${clientId}`);
      console.log("GMAIL_CLIENT_SECRET=<the same client secret you used>");
      console.log(`GMAIL_REFRESH_TOKEN=${refreshToken}`);
      console.log("GMAIL_SENDER_EMAIL=<bot Gmail or Workspace address>");
      console.log("TRANSCRIPT_EMAIL_TO=arjhnpr@gmail.com");
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("OAuth failed. Check the terminal.");
    console.error(err);
  } finally {
    server.close();
  }
});

server.listen(port, () => {
  console.log(`Listening on ${redirectUri}`);
  console.log("\nOpen this URL and authorize the bot Gmail/Workspace account:\n");
  console.log(authUrl.toString());
});
