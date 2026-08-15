/**
 * Abstracts the hosted-browser vendor so Steel.dev (primary, self-hosted for
 * cost control) and Browserbase (managed fallback) are interchangeable.
 * Stagehand attaches to the session via `connectUrl` (a CDP websocket
 * endpoint) — the provider's job is just lifecycle + video capture, not
 * driving the page itself.
 */
export interface BrowserSession {
  id: string;
  /** CDP websocket endpoint Stagehand/Playwright connects to. */
  connectUrl: string;
  /** Present once the session ends and a recording was captured. */
  videoPath?: string;
}

export interface BrowserProvider {
  readonly name: string;

  createSession(options: { recordVideo: boolean }): Promise<BrowserSession>;

  /** Ends the session and, if recording was on, finalizes the video file. */
  closeSession(session: BrowserSession): Promise<{ videoPath?: string }>;
}

export class BrowserProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BrowserProviderError";
  }
}
