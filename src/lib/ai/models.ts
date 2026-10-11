// Select an account-supported model without changing application code.
const DEFAULT_MODEL = "claude-opus-4-8";
export const VIDEO_ANALYSIS_MODEL =
  process.env.ANTHROPIC_VIDEO_MODEL?.trim() || DEFAULT_MODEL;
export const TEAM_INSIGHTS_MODEL =
  process.env.ANTHROPIC_INSIGHTS_MODEL?.trim() || DEFAULT_MODEL;
