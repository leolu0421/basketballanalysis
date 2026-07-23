import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const AI_INSIGHTS_MODEL = "claude-opus-4-8";

export function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function getClient() {
  if (!isAiConfigured()) return null;
  if (!client) client = new Anthropic();
  return client;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured");
    this.name = "AiNotConfiguredError";
  }
}

const BadgeSchema = z.enum(["NEEDS_FOCUS", "AVERAGE", "GOOD", "SUPER"]);

const MetricInsightSchema = z.object({
  badge: BadgeSchema,
  narrative: z.string(),
});

export const TeamInsightsSchema = z.object({
  whatsWorking: z.array(z.string()).length(2),
  focusAreas: z.array(z.string()).length(2),
  suggestions: z.string(),
  metrics: z.object({
    shotMix: MetricInsightSchema,
    pointsPerShot: MetricInsightSchema,
    assistRate: MetricInsightSchema,
    turnovers: MetricInsightSchema,
    rebounds: MetricInsightSchema,
    defensiveImpact: MetricInsightSchema,
  }),
});

export type TeamInsights = z.infer<typeof TeamInsightsSchema>;

export type TeamInsightsMetricInputs = {
  shotMixPct: number;
  pointsPerShot: number;
  assistRatePct: number;
  turnovers: number;
  rebounds: number;
  defensiveImpact: number;
};

export type TeamInsightsInput = {
  teamName: string;
  opponentName: string;
  teamScore: number | null;
  opponentScore: number | null;
  metrics: TeamInsightsMetricInputs;
};

export async function generateTeamInsights(
  input: TeamInsightsInput
): Promise<TeamInsights> {
  const anthropic = getClient();
  if (!anthropic) throw new AiNotConfiguredError();

  const { teamName, opponentName, teamScore, opponentScore, metrics } = input;

  const prompt = `You are a basketball analyst writing a short post-game report for a youth/club team's coach.

Team: ${teamName}
Opponent: ${opponentName}
Score: ${teamScore ?? "unknown"} - ${opponentScore ?? "unknown"}

Already-computed stats for this game (use these exact numbers, do not recalculate or invent any other numbers):
- 2PT field goal percentage (shot mix): ${metrics.shotMixPct.toFixed(1)}%
- Points per shot attempt: ${metrics.pointsPerShot.toFixed(2)}
- Assist rate (assists per made field goal): ${metrics.assistRatePct.toFixed(1)}%
- Turnovers: ${metrics.turnovers}
- Total rebounds: ${metrics.rebounds}
- Defensive impact (steals + blocks): ${metrics.defensiveImpact}

Write:
1. Exactly two "what's working" bullet points (things the team did well, grounded in the numbers above).
2. Exactly two "focus area" bullet points (things to improve, grounded in the numbers above).
3. One short paragraph of coaching suggestions.
4. For each of the six metrics above, a qualitative badge (NEEDS_FOCUS, AVERAGE, GOOD, or SUPER) and a 1-2 sentence narrative explaining what the number means and how to improve or maintain it.

Use only the numbers given above. Keep language plain, specific, and encouraging, suitable for a youth sports coach.`;

  const response = await anthropic.messages.parse({
    model: AI_INSIGHTS_MODEL,
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    output_config: {
      format: zodOutputFormat(TeamInsightsSchema),
    },
    messages: [{ role: "user", content: prompt }],
  });

  if (!response.parsed_output) {
    throw new Error("AI did not return a valid structured response");
  }

  return response.parsed_output;
}
