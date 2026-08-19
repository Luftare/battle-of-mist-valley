import { createMatchSim, type MatchSim } from "./matchSim";
import {
  SIM_DT,
  type MatchEvent,
  type MatchSnapshot,
  type PlayerCommand,
} from "./types";
import type { Team } from "../theme/colors";

export interface MatchDriver {
  localTeam: Team;
  vsAi: boolean;
  roomCode?: string;
  enqueue: (cmd: PlayerCommand) => void;
  start: () => void;
  readonly started: boolean;
  step: (dt: number) => { snapshot: MatchSnapshot; events: MatchEvent[] };
  dispose: () => void;
}

export function createLocalDriver(opts?: {
  seed?: number;
  localTeam?: Team;
}): MatchDriver {
  const localTeam = opts?.localTeam ?? "blue";
  const sim: MatchSim = createMatchSim({
    seed: opts?.seed ?? 1,
    vsAi: true,
  });
  let acc = 0;
  return {
    localTeam,
    vsAi: true,
    enqueue: (cmd) => sim.enqueue(localTeam, cmd),
    start: () => sim.start(),
    get started() {
      return sim.started;
    },
    step: (dt) => {
      if (!sim.started) {
        return { snapshot: sim.snapshot(), events: [] };
      }
      acc += Math.min(0.25, dt);
      const events: MatchEvent[] = [];
      let steps = 0;
      while (acc >= SIM_DT && steps < 8) {
        events.push(...sim.tick(SIM_DT));
        acc -= SIM_DT;
        steps += 1;
      }
      return { snapshot: sim.snapshot(), events };
    },
    dispose: () => {},
  };
}
