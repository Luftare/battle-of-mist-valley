import type { Team } from "../theme/colors";
import type { MatchEvent, MatchSnapshot, PlayerCommand } from "../sim/types";

export type ClientMessage =
  | { type: "create" }
  | { type: "join"; code: string }
  | { type: "ready" }
  | { type: "command"; command: PlayerCommand };

export type ServerMessage =
  | {
      type: "room";
      code: string;
      team: Team;
      seats: { blue: boolean; red: boolean };
    }
  | { type: "start"; snapshot: MatchSnapshot }
  | { type: "event"; events: MatchEvent[] }
  | { type: "snapshot"; snapshot: MatchSnapshot }
  | { type: "peerLeft"; winner?: Team }
  | { type: "error"; message: string };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMessage | null {
  try {
    const msg = JSON.parse(raw) as ClientMessage;
    if (!msg || typeof msg !== "object" || !("type" in msg)) return null;
    return msg;
  } catch {
    return null;
  }
}

export function decodeServer(raw: string): ServerMessage | null {
  try {
    const msg = JSON.parse(raw) as ServerMessage;
    if (!msg || typeof msg !== "object" || !("type" in msg)) return null;
    return msg;
  } catch {
    return null;
  }
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomRoomCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}
