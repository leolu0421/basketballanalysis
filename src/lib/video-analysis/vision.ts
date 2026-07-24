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

const MADE_SHOT_TYPES = ["FG2_MADE", "FG3_MADE", "FT_MADE"] as const;

const CandidateGuessesSchema = z.object({
  guesses: z.array(
    z.object({
      candidateIndex: z.number().int(),
      jerseyNumber: z.string().nullable(),
      statType: z.enum(MADE_SHOT_TYPES).nullable(),
    })
  ),
});

export type CandidateGuess = z.infer<typeof CandidateGuessesSchema>["guesses"][number];

export type CandidateToGuess = {
  index: number;
  previousScoreText: string;
  scoreText: string;
  frames: { path: string; timestampSeconds: number }[];
};

export type RosterPlayer = { jerseyNumber: string; firstName: string; lastName: string };

/**
 * For each scoreboard-change candidate, asks Claude vision to look at the
 * nearby gameplay frames and guess which of OUR roster players scored (by
 * jersey number) and what kind of made shot it was. Frames are sparse
 * (sampled every FRAME_INTERVAL_SECONDS), so this is a best-effort guess
 * meant to be confirmed or corrected by a coach, not treated as ground truth.
 */
export async function guessCandidateStatsBatch(
  candidates: CandidateToGuess[],
  roster: RosterPlayer[]
): Promise<CandidateGuess[]> {
  if (candidates.length === 0) return [];
  const anthropic = getClient();

  const rosterText = roster.map((p) => `#${p.jerseyNumber} ${p.firstName} ${p.lastName}`).join(", ");

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }
  > = [
    {
      type: "text",
      text: `You are reviewing moments from a basketball game video where the on-screen scoreboard changed, to help a coach guess which of OUR roster players scored and what kind of shot it was. Our roster (jersey number and name): ${rosterText}. For each candidate below you're shown a short sequence of frames from around that scoring moment, in chronological order. Use every cue visible ACROSS that sequence, not just an isolated digit on one frame:
- Jersey number and jersey/uniform color (to tell our team from the opponent).
- Who is holding or releasing the ball as the frames progress, court position relative to the hoop, and relative height/build compared to nearby players.
- Any referee visible in frame: officials use standard hand signals that are often clearer than reading court position — both arms raised with three fingers extended means a made three-pointer, a raised fist or "T" hand shape signals a foul/technical, an arm swept across the body signals a stoppage, and pointing to the free-throw line indicates free throws. If a referee signal is visible, weight it heavily — it's usually more reliable than judging foot position against the three-point arc.
Cross-check these cues against each other within the sequence before deciding — e.g. if the jersey number is blurry on one frame but the same player's position and uniform color are consistent across the sequence, use that continuity to corroborate the read. Report the jersey number of the player who scored ONLY if it clearly matches one of our roster's jersey numbers above — set jerseyNumber to null if it's unclear, not visible, or looks like the opposing team scored instead. For statType, use the score change, any referee signal, and the player's position (e.g. at the free-throw line vs. in open play) to pick FG2_MADE, FG3_MADE, or FT_MADE — set it to null if you can't reasonably tell. Report exactly one entry per candidateIndex given, even if both fields end up null.`,
    },
  ];

  for (const candidate of candidates) {
    content.push({
      type: "text",
      text: `Candidate candidateIndex=${candidate.index}: score went from ${candidate.previousScoreText} to ${candidate.scoreText}.`,
    });
    for (const frame of candidate.frames) {
      const data = (await readFile(frame.path)).toString("base64");
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data },
      });
    }
  }

  const response = await anthropic.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    messages: [{ role: "user", content }],
    output_config: {
      format: zodOutputFormat(CandidateGuessesSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error("Vision analysis did not return a valid structured response");
  }

  return response.parsed_output.guesses;
}

const TrackGuessSchema = z.object({
  trackId: z.number().int().nullable(),
  jerseyNumber: z.string().nullable(),
  statType: z.enum(MADE_SHOT_TYPES).nullable(),
});

export type TrackGuess = z.infer<typeof TrackGuessSchema>;
export type TrackToGuess = { trackId: number; crops: string[] };

/**
 * Preferred, higher-fidelity guess path: instead of reading a jersey number
 * off a wide-shot frame, this takes pre-cropped torso close-ups from a
 * player-tracking pass (see scripts/track_players.py — YOLO person detection
 * + ByteTrack, so each trackId is the same physical person across the clip)
 * and asks Claude to read jersey numbers off the zoomed crops instead. Falls
 * back to guessCandidateStatsBatch's wide-frame approach where tracking
 * isn't available (see pipeline.ts).
 */
export async function guessCandidateFromTracks(
  candidate: { previousScoreText: string; scoreText: string },
  tracks: TrackToGuess[],
  roster: RosterPlayer[]
): Promise<TrackGuess> {
  if (tracks.length === 0) {
    return { trackId: null, jerseyNumber: null, statType: null };
  }
  const anthropic = getClient();

  const rosterText = roster.map((p) => `#${p.jerseyNumber} ${p.firstName} ${p.lastName}`).join(", ");

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }
  > = [
    {
      type: "text",
      text: `You are reviewing a basketball scoring moment to help a coach identify which of OUR roster players scored. Our roster (jersey number and name): ${rosterText}. The on-screen scoreboard changed from ${candidate.previousScoreText} to ${candidate.scoreText} around this moment. Below are cropped, zoomed-in torso images of each person who was tracked on screen near this moment, grouped by trackId — a person-tracking pass already confirmed all crops under the same trackId are the same physical person, so cross-reference all of a track's crops together (a number blurry in one crop may be clear in another of the same track) before deciding what jersey number it shows. These crops are zoomed in specifically so jersey numbers are more readable than in a wide shot — trust a clear digit read here over general court-position guessing. For each track, try to read a jersey number. Then decide which trackId, if any, is the player who scored: it must have a jersey number matching one of our roster's numbers above. Report that trackId and the jersey number you read — or null for both if no track clearly matches one of our players (e.g. the crops are too blurry, or it looks like the opposing team scored). Also report statType (FG2_MADE, FG3_MADE, or FT_MADE) using the score delta and whatever court context is visible in the crops — null if you can't reasonably tell.`,
    },
  ];

  for (const track of tracks) {
    content.push({ type: "text", text: `trackId=${track.trackId}:` });
    for (const cropPath of track.crops) {
      const data = (await readFile(cropPath)).toString("base64");
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data },
      });
    }
  }

  const response = await anthropic.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    messages: [{ role: "user", content }],
    output_config: {
      format: zodOutputFormat(TrackGuessSchema),
    },
  });

  if (!response.parsed_output) {
    throw new Error("Vision analysis did not return a valid structured response");
  }

  return response.parsed_output;
}
