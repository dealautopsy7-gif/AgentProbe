import { getEnv } from "../../config/env.js";
import type { BrowserProvider, BrowserSession } from "../BrowserProvider.js";

/**
 * Managed fallback BrowserProvider — used when Steel.dev is unavailable or
 * over capacity. Browserbase bills per browser-minute, so prefer Steel for
 * routine runs; this exists so an outage doesn't take the product down.
 *
 * TODO before this can run for real:
 *   1. `npm install @browserbasehq/sdk`.
 *   2. Create a session via the SDK with BROWSERBASE_API_KEY / PROJECT_ID,
 *      requesting video recording if supported on the plan.
 *   3. Map the SDK's session object to { id, connectUrl }.
 */
export class BrowserbaseBrowserProvider implements BrowserProvider {
  readonly name = "browserbase";

  async createSession(_options: { recordVideo: boolean }): Promise<BrowserSession> {
    const env = getEnv();
    void env.BROWSERBASE_API_KEY;
    void env.BROWSERBASE_PROJECT_ID;
    throw new Error(
      "BrowserbaseBrowserProvider.createSession is not implemented yet — wire up the Browserbase SDK per the TODO in this file.",
    );
  }

  async closeSession(_session: BrowserSession): Promise<{ videoPath?: string }> {
    throw new Error("BrowserbaseBrowserProvider.closeSession is not implemented yet.");
  }
}
