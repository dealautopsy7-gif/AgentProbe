/**
 * One-off exploratory check (not part of the app): tests whether
 * AICredits.in's Gemini vision endpoint can describe a real screenshot and
 * spot a visible price — nothing more. This is NOT a computer-use test:
 * no click/action output is requested or evaluated. Their catalog doesn't
 * include a computer-use-class model, so this is purely a quality
 * sanity-check on the "safe" chat+vision surface, per the user's explicit
 * request to keep this separate from the AgentDriver path.
 *
 * Run with: npx tsx scripts/verify-aicredits-vision.ts <path-to-screenshot.png>
 */
import { readFileSync } from "node:fs";
import { getEnv } from "../src/config/env.js";

async function main() {
  const env = getEnv();
  if (!env.AICREDITS_API_KEY) throw new Error("AICREDITS_API_KEY is not set");

  const imagePath = process.argv[2];
  if (!imagePath) throw new Error("Usage: verify-aicredits-vision.ts <path-to-screenshot.png>");

  const imageBuffer = readFileSync(imagePath);
  const dataUri = `data:image/png;base64,${imageBuffer.toString("base64")}`;

  console.log(`Sending ${(imageBuffer.length / 1024).toFixed(0)}KB screenshot to ${env.AICREDITS_MODEL}...\n`);

  const res = await fetch(`${env.AICREDITS_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.AICREDITS_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.AICREDITS_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe what's on this page in 2-3 sentences. Then answer explicitly: is there a visible price anywhere on the page? If yes, what is it and is anything blocking it (like a modal or overlay)?",
            },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AICredits API returned ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content;
  console.log("--- Model response ---");
  console.log(content ?? "(no content returned)");

  if (data.usage) {
    console.log("\n--- Usage ---");
    console.log(
      `prompt_tokens=${data.usage.prompt_tokens ?? "?"} completion_tokens=${data.usage.completion_tokens ?? "?"} total_tokens=${data.usage.total_tokens ?? "?"}`,
    );
  }
}

main().catch((err) => {
  console.error("VISION CHECK FAILED:", err);
  process.exit(1);
});
