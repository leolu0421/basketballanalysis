import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const FrameReadsSchema = z.object({
  reads: z.array(
    z.object({
      frameIndex: z.number().int(),
      scoreVisible: z.boolean(),
      scoreText: z.string().nullable(),
    })
  ),
});

export type FrameRead = z.infer<typeof FrameReadsSchema>["reads"][number];

export type FrameToRead = { index: number; path: string; timestampSeconds: number };

let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Sends a batch of video frames to Claude vision and asks it to transcribe
 * whatever on-screen scoreboard text is visible in each one.
 */
export async function readScoreboardBatch(
  frames: FrameToRead[]
): Promise<FrameRead[]> {
  const anthropic = getClient();

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }
  > = [
    {
      type: "text",
      text: `Each image below is a still frame from a basketball game video, shown in chronological order. For each frame, look for an on-screen scoreboard overlay and transcribe the score exactly as displayed (e.g. "42-38"). If no scoreboard overlay is visible in a frame, set scoreVisible to false and scoreText to null. Report exactly one entry per frame, using the exact frameIndex given before each image.`,
    },
  ];

  for (const frame of frames) {
    content.push({
      type: "text",
      text: `Frame frameIndex=${frame.index} (approx. t=${frame.timestampSeconds}s):`,
    });
    const data = (await readFile(frame.path)).toString("base64");
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data },
    });
  }

  const response = await anthropic.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    messages: [{ role: "user", content }],
    output_config: {
      format: zodOutputFormat(FrameReadsSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error("Vision analysis did not return a valid structured response");
  }

  return response.parsed_output.reads;
}
