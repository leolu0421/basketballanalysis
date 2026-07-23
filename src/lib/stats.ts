import { StatType } from "@/lib/stat-types";

export type StatEventLike = {
  playerId: string;
  type: string;
};

export type BoxScoreLine = {
  playerId: string;
  pts: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  fgm: number;
  fga: number;
  fgPct: number;
  fg2m: number;
  fg2a: number;
  fg2Pct: number;
  fg3m: number;
  fg3a: number;
  fg3Pct: number;
  ftm: number;
  fta: number;
  ftPct: number;
  eff: number;
  tsPct: number;
  fpts: number;
};

function pct(made: number, attempted: number) {
  if (attempted === 0) return 0;
  return (made / attempted) * 100;
}

export function emptyBoxScoreLine(playerId: string): BoxScoreLine {
  return {
    playerId,
    pts: 0,
    oreb: 0,
    dreb: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
    fgm: 0,
    fga: 0,
    fgPct: 0,
    fg2m: 0,
    fg2a: 0,
    fg2Pct: 0,
    fg3m: 0,
    fg3a: 0,
    fg3Pct: 0,
    ftm: 0,
    fta: 0,
    ftPct: 0,
    eff: 0,
    tsPct: 0,
    fpts: 0,
  };
}

/** Aggregates raw stat events into a box score line for a single player. */
export function computeBoxScoreLine(
  playerId: string,
  events: StatEventLike[]
): BoxScoreLine {
  const line = emptyBoxScoreLine(playerId);

  for (const e of events) {
    const type = e.type as StatType;
    switch (type) {
      case "FG2_MADE":
        line.fg2m++;
        line.fg2a++;
        line.pts += 2;
        break;
      case "FG2_MISSED":
        line.fg2a++;
        break;
      case "FG3_MADE":
        line.fg3m++;
        line.fg3a++;
        line.pts += 3;
        break;
      case "FG3_MISSED":
        line.fg3a++;
        break;
      case "FT_MADE":
        line.ftm++;
        line.fta++;
        line.pts += 1;
        break;
      case "FT_MISSED":
        line.fta++;
        break;
      case "OREB":
        line.oreb++;
        break;
      case "DREB":
        line.dreb++;
        break;
      case "AST":
        line.ast++;
        break;
      case "STL":
        line.stl++;
        break;
      case "BLK":
        line.blk++;
        break;
      case "TOV":
        line.tov++;
        break;
      case "FOUL":
        line.pf++;
        break;
    }
  }

  line.reb = line.oreb + line.dreb;
  line.fgm = line.fg2m + line.fg3m;
  line.fga = line.fg2a + line.fg3a;
  line.fgPct = pct(line.fgm, line.fga);
  line.fg2Pct = pct(line.fg2m, line.fg2a);
  line.fg3Pct = pct(line.fg3m, line.fg3a);
  line.ftPct = pct(line.ftm, line.fta);

  line.eff =
    line.pts +
    line.reb +
    line.ast +
    line.stl +
    line.blk -
    (line.fga - line.fgm) -
    (line.fta - line.ftm) -
    line.tov;

  const tsDenominator = 2 * (line.fga + 0.44 * line.fta);
  line.tsPct = tsDenominator === 0 ? 0 : (line.pts / tsDenominator) * 100;

  line.fpts =
    line.pts +
    line.reb * 1.2 +
    line.ast * 1.5 +
    line.stl * 3 +
    line.blk * 3 -
    line.tov;

  return line;
}

/** Groups events by playerId and computes a box score line for each. */
export function computeBoxScoreByPlayer(
  events: StatEventLike[]
): Record<string, BoxScoreLine> {
  const byPlayer: Record<string, StatEventLike[]> = {};
  for (const e of events) {
    (byPlayer[e.playerId] ??= []).push(e);
  }
  const result: Record<string, BoxScoreLine> = {};
  for (const [playerId, playerEvents] of Object.entries(byPlayer)) {
    result[playerId] = computeBoxScoreLine(playerId, playerEvents);
  }
  return result;
}

export function sumBoxScoreLines(lines: BoxScoreLine[]): BoxScoreLine {
  const total = emptyBoxScoreLine("TEAM");
  for (const l of lines) {
    total.pts += l.pts;
    total.oreb += l.oreb;
    total.dreb += l.dreb;
    total.reb += l.reb;
    total.ast += l.ast;
    total.stl += l.stl;
    total.blk += l.blk;
    total.tov += l.tov;
    total.pf += l.pf;
    total.fgm += l.fgm;
    total.fga += l.fga;
    total.fg2m += l.fg2m;
    total.fg2a += l.fg2a;
    total.fg3m += l.fg3m;
    total.fg3a += l.fg3a;
    total.ftm += l.ftm;
    total.fta += l.fta;
    total.fpts += l.fpts;
  }
  total.fgPct = pct(total.fgm, total.fga);
  total.fg2Pct = pct(total.fg2m, total.fg2a);
  total.fg3Pct = pct(total.fg3m, total.fg3a);
  total.ftPct = pct(total.ftm, total.fta);
  const tsDenominator = 2 * (total.fga + 0.44 * total.fta);
  total.tsPct = tsDenominator === 0 ? 0 : (total.pts / tsDenominator) * 100;
  total.eff =
    total.pts +
    total.reb +
    total.ast +
    total.stl +
    total.blk -
    (total.fga - total.fgm) -
    (total.fta - total.ftm) -
    total.tov;
  return total;
}
