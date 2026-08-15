import Steel from "steel-sdk";
import { getEnv } from "../../config/env.js";
import type { BrowserProvider, BrowserSession } from "../BrowserProvider.js";

/**
 * Primary BrowserProvider — Steel.dev, self-hosted via docker-compose to
 * control cost. Verified against a real local instance
 * (`ghcr.io/steel-dev/steel-browser-api:latest`) before wiring this in:
 * `sessions.create()` returns `websocketUrl`, a CDP endpoint Playwright's
 * `chromium.connectOverCDP()` connects to directly.
 *
 * Note on video: Steel's own recording is RRWeb session-event capture
 * (`GET /sessions/:id/events`), not a raw video file — turning that into
 * an MP4 for videoPipeline.ts's ffmpeg trim-and-caption step needs an
 * RRWeb-replay-and-record pass, which is a separate, not-yet-built piece.
 * closeSession() never returns a videoPath yet; that's expected, not a bug.
 */
export class SteelBrowserProvider implements BrowserProvider {
  readonly name = "steel";
  private client: Steel;

  constructor() {
    const env = getEnv();
    this.client = new Steel({ baseURL: env.STEEL_API_URL, steelAPIKey: env.STEEL_API_KEY });
  }

  async createSession(_options: { recordVideo: boolean }): Promise<BrowserSession> {
    const session = await this.client.sessions.create();
    return { id: session.id, connectUrl: session.websocketUrl };
  }

  async closeSession(session: BrowserSession): Promise<{ videoPath?: string }> {
    await this.client.sessions.release(session.id);
    return {};
  }
}
