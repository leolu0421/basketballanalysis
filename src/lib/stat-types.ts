export const STAT_TYPES = [
  "FG2_MADE",
  "FG2_MISSED",
  "FG3_MADE",
  "FG3_MISSED",
  "FT_MADE",
  "FT_MISSED",
  "OREB",
  "DREB",
  "AST",
  "STL",
  "BLK",
  "TOV",
  "FOUL",
] as const;

export type StatType = (typeof STAT_TYPES)[number];

export const STAT_LABELS: Record<StatType, string> = {
  FG2_MADE: "2PT Made",
  FG2_MISSED: "2PT Missed",
  FG3_MADE: "3PT Made",
  FG3_MISSED: "3PT Missed",
  FT_MADE: "FT Made",
  FT_MISSED: "FT Missed",
  OREB: "Off. Rebound",
  DREB: "Def. Rebound",
  AST: "Assist",
  STL: "Steal",
  BLK: "Block",
  TOV: "Turnover",
  FOUL: "Foul",
};

export const SHOT_TYPES: StatType[] = [
  "FG2_MADE",
  "FG2_MISSED",
  "FG3_MADE",
  "FG3_MISSED",
];

export function isShotType(type: string): boolean {
  return SHOT_TYPES.includes(type as StatType);
}
