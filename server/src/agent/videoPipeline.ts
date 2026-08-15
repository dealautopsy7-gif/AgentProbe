import { spawn } from "node:child_process";

export interface AssembleScreenshotsInput {
  /** Directory containing step-001.png, step-002.png, ... (zero-padded to 3 digits, written by runStagehandAttempt.ts). */
  screenshotDir: string;
  outputPath: string;
  framesPerSecond: number;
}

/**
 * BROWSER_PROVIDER=local has no continuous screen recording (Stagehand's
 * local Page wraps its own lightweight CDP connection, not a Playwright
 * BrowserContext with a recordVideo option to hook into) — this assembles
 * the per-step screenshots already being captured for the reasoning loop
 * into a real, honest (if low-frame-rate) video instead. It's genuinely
 * what happened, one frame per decided step, not a fabricated recording.
 */
export function assembleScreenshotsToVideo(input: AssembleScreenshotsInput): Promise<void> {
  const { screenshotDir, outputPath, framesPerSecond } = input;
  const args = [
    "-y",
    "-framerate", String(framesPerSecond),
    "-i", `${screenshotDir}/step-%03d.png`,
    "-pix_fmt", "yuv420p",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg (screenshot assembly) exited with code ${code}\n${stderr}`));
    });
  });
}

export interface TrimHighlightInput {
  inputPath: string;
  outputPath: string;
  /** Seconds into the recording where the failure happened. */
  failureTimestampSec: number;
  captionText: string;
  /** Seconds of context to keep before/after the failure moment. */
  windowSec?: { before: number; after: number };
}

/**
 * Trims the full attempt recording to ~15-25s around the failure moment and
 * burns in the agent's own caption text — this clip is the shareable growth
 * artifact (spec: "make it clean").
 *
 * ffmpeg on PATH confirmed present in this environment (not assumed) —
 * verified via a real trim+caption call during BROWSER_PROVIDER=local
 * end-to-end testing. That same real call is what caught the escaping bug
 * below: a caption containing a comma ("...CRUISER', and its price...")
 * made ffmpeg's filtergraph parser split it into a second, nonexistent
 * filter ("No such filter: 'and its price'") — commas are a filtergraph-
 * level separator, not just a drawtext option character, and the original
 * escaping only handled ':' and "'". Order matters: backslash must be
 * escaped first, or the backslashes inserted for the other characters
 * would themselves get double-escaped.
 */
export function trimHighlightClip(input: TrimHighlightInput): Promise<void> {
  const { inputPath, outputPath, failureTimestampSec, captionText, windowSec = { before: 10, after: 10 } } = input;

  const start = Math.max(0, failureTimestampSec - windowSec.before);
  const duration = windowSec.before + windowSec.after;
  const escapedCaption = captionText
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%")
    .replace(/'/g, "'\\''");

  const args = [
    "-y",
    "-ss", String(start),
    "-i", inputPath,
    "-t", String(duration),
    "-vf", `drawtext=text='${escapedCaption}':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.6:boxborderw=10:x=(w-text_w)/2:y=h-th-40`,
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr}`));
    });
  });
}
