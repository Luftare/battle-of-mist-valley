import { createTeamTechLevels } from "../game/upgrades";
import type { Team } from "../theme/colors";
import type { MatchDriver } from "../sim/driver";
import { SIM_DT, type MatchEvent, type MatchSnapshot, type PlayerCommand } from "../sim/types";
import {
  decodeServer,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "./protocol";

const INTERP_DELAY_SEC = 0.12;

export interface RemoteDriverOpts {
  ws: WebSocket;
  localTeam: Team;
  roomCode: string;
  onPeerLeft?: () => void;
  onError?: (message: string) => void;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function interpolateSnapshots(
  from: MatchSnapshot,
  to: MatchSnapshot,
  t: number,
): MatchSnapshot {
  const u = Math.max(0, Math.min(1, t));
  const units = to.units.map((tu) => {
    const fu = from.units.find((x) => x.id === tu.id);
    if (!fu) return tu;
    return {
      ...tu,
      x: lerp(fu.x, tu.x, u),
      z: lerp(fu.z, tu.z, u),
      yaw: lerpAngle(fu.yaw, tu.yaw, u),
    };
  });
  const missiles = to.missiles.map((tm) => {
    const fm = from.missiles.find((x) => x.id === tm.id);
    if (!fm) return tm;
    return {
      ...tm,
      x: lerp(fm.x, tm.x, u),
      y: lerp(fm.y, tm.y, u),
      z: lerp(fm.z, tm.z, u),
      yaw: lerpAngle(fm.yaw, tm.yaw, u),
      pitch: lerp(fm.pitch, tm.pitch, u),
    };
  });
  return { ...to, units, missiles };
}

export function createRemoteDriver(opts: RemoteDriverOpts): MatchDriver {
  const pendingEvents: MatchEvent[] = [];
  const buffer: { t: number; snap: MatchSnapshot }[] = [];
  let started = false;
  let clock = 0;
  let latest: MatchSnapshot | null = null;
  let disposed = false;

  function send(msg: ClientMessage): void {
    if (opts.ws.readyState === WebSocket.OPEN) opts.ws.send(encode(msg));
  }

  const onMessage = (ev: MessageEvent) => {
    if (typeof ev.data !== "string") return;
    const msg: ServerMessage | null = decodeServer(ev.data);
    if (!msg) return;
    if (msg.type === "start") {
      started = true;
      latest = msg.snapshot;
      buffer.length = 0;
      buffer.push({ t: clock, snap: msg.snapshot });
    } else if (msg.type === "event") {
      pendingEvents.push(...msg.events);
    } else if (msg.type === "snapshot") {
      latest = msg.snapshot;
      buffer.push({ t: clock, snap: msg.snapshot });
      while (buffer.length > 24) buffer.shift();
    } else if (msg.type === "peerLeft") {
      if (msg.winner && latest) {
        latest = { ...latest, gameOver: true, winner: msg.winner };
        pendingEvents.push({ type: "MatchEnded", winner: msg.winner });
      }
      opts.onPeerLeft?.();
    } else if (msg.type === "error") {
      opts.onError?.(msg.message);
    }
  };
  opts.ws.addEventListener("message", onMessage);

  return {
    localTeam: opts.localTeam,
    vsAi: false,
    roomCode: opts.roomCode,
    enqueue: (cmd: PlayerCommand) => send({ type: "command", command: cmd }),
    start: () => send({ type: "ready" }),
    get started() {
      return started;
    },
    step: (dt: number) => {
      clock += dt;
      const events = pendingEvents.splice(0, pendingEvents.length);
      if (!latest) {
        const emptyTech = createTeamTechLevels();
        return {
          snapshot: {
            tick: 0,
            elapsed: 0,
            coins: { blue: 0, red: 0 },
            tech: { blue: { ...emptyTech }, red: { ...emptyTech } },
            research: { blue: null, red: null },
            flagOwner: null,
            gameOver: false,
            winner: null,
            slots: [],
            turrets: [],
            units: [],
            missiles: [],
          },
          events,
        };
      }
      const renderAt = clock - INTERP_DELAY_SEC;
      let from = buffer[0];
      let to = buffer[buffer.length - 1];
      for (let i = 0; i < buffer.length - 1; i++) {
        if (buffer[i].t <= renderAt && buffer[i + 1].t >= renderAt) {
          from = buffer[i];
          to = buffer[i + 1];
          break;
        }
      }
      const span = Math.max(SIM_DT, to.t - from.t);
      const t = (renderAt - from.t) / span;
      const snapshot =
        t <= 0 ? from.snap : t >= 1 ? to.snap : interpolateSnapshots(from.snap, to.snap, t);
      return { snapshot, events };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      opts.ws.removeEventListener("message", onMessage);
    },
  };
}
