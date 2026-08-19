import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { createMatchSim, type MatchSim } from "../sim/matchSim";
import { SIM_DT, SNAPSHOT_HZ, SIM_HZ, type MatchEvent } from "../sim/types";
import type { Team } from "../theme/colors";
import {
  decodeClient,
  encode,
  randomRoomCode,
  type ServerMessage,
} from "./protocol";

interface Seat {
  ws: WebSocket;
  team: Team;
  ready: boolean;
}

interface Room {
  code: string;
  seats: Seat[];
  sim: MatchSim | null;
  timer: ReturnType<typeof setInterval> | null;
  snapshotCounter: number;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
}

function broadcast(room: Room, msg: ServerMessage): void {
  for (const seat of room.seats) send(seat.ws, msg);
}

function otherTeam(team: Team): Team {
  return team === "blue" ? "red" : "blue";
}

export function attachMatchServer(httpServer: Server): WebSocketServer {
  // `noServer` so we do not bind the HTTP `upgrade` handler ourselves in a way
  // that aborts Vite's HMR websocket (ws v8 abortHandshake on path mismatch).
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<string, Room>();

  const onUpgrade = (
    req: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ): void => {
    const pathname = req.url
      ? new URL(req.url, "http://localhost").pathname
      : "";
    if (pathname !== "/ws") return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };
  httpServer.on("upgrade", onUpgrade);
  wss.on("close", () => {
    httpServer.off("upgrade", onUpgrade);
  });

  function uniqueCode(): string {
    for (let i = 0; i < 20; i++) {
      const code = randomRoomCode();
      if (!rooms.has(code)) return code;
    }
    return randomRoomCode() + randomRoomCode();
  }

  function stopRoom(room: Room): void {
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
    room.sim = null;
  }

  function beginMatch(room: Room): void {
    if (room.sim) return;
    const sim = createMatchSim({ vsAi: false, seed: (Date.now() ^ 0x9e3779b9) >>> 0 });
    room.sim = sim;
    sim.start();
    const snapshot = sim.snapshot();
    broadcast(room, { type: "start", snapshot });
    room.snapshotCounter = 0;
    const snapshotEvery = Math.max(1, Math.round(SIM_HZ / SNAPSHOT_HZ));
    room.timer = setInterval(() => {
      if (!room.sim) return;
      const events: MatchEvent[] = room.sim.tick(SIM_DT);
      if (events.length > 0) broadcast(room, { type: "event", events });
      room.snapshotCounter += 1;
      if (room.snapshotCounter % snapshotEvery === 0) {
        broadcast(room, { type: "snapshot", snapshot: room.sim.snapshot() });
      }
    }, SIM_DT * 1000);
  }

  function seatFor(ws: WebSocket): { room: Room; seat: Seat } | null {
    for (const room of rooms.values()) {
      const seat = room.seats.find((s) => s.ws === ws);
      if (seat) return { room, seat };
    }
    return null;
  }

  function leave(ws: WebSocket): void {
    const found = seatFor(ws);
    if (!found) return;
    const { room, seat } = found;
    room.seats = room.seats.filter((s) => s.ws !== ws);
    if (room.sim) {
      const winner = otherTeam(seat.team);
      for (const other of room.seats) {
        send(other.ws, { type: "peerLeft", winner });
      }
      stopRoom(room);
    }
    if (room.seats.length === 0) {
      stopRoom(room);
      rooms.delete(room.code);
    } else {
      broadcast(room, {
        type: "room",
        code: room.code,
        team: room.seats[0].team,
        seats: {
          blue: room.seats.some((s) => s.team === "blue"),
          red: room.seats.some((s) => s.team === "red"),
        },
      });
    }
  }

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    ws.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString();
      const msg = decodeClient(raw);
      if (!msg) return;

      if (msg.type === "create") {
        const code = uniqueCode();
        const room: Room = {
          code,
          seats: [{ ws, team: "blue", ready: false }],
          sim: null,
          timer: null,
          snapshotCounter: 0,
        };
        rooms.set(code, room);
        send(ws, {
          type: "room",
          code,
          team: "blue",
          seats: { blue: true, red: false },
        });
        return;
      }

      if (msg.type === "join") {
        const room = rooms.get(msg.code.toUpperCase());
        if (!room) {
          send(ws, { type: "error", message: "Room not found." });
          return;
        }
        if (room.seats.length >= 2 || room.sim) {
          send(ws, { type: "error", message: "Room is full." });
          return;
        }
        const taken = new Set(room.seats.map((s) => s.team));
        const team: Team = taken.has("blue") ? "red" : "blue";
        room.seats.push({ ws, team, ready: false });
        for (const seat of room.seats) {
          send(seat.ws, {
            type: "room",
            code: room.code,
            team: seat.team,
            seats: {
              blue: room.seats.some((s) => s.team === "blue"),
              red: room.seats.some((s) => s.team === "red"),
            },
          });
        }
        return;
      }

      const found = seatFor(ws);
      if (!found) {
        send(ws, { type: "error", message: "Join a room first." });
        return;
      }
      const { room, seat } = found;

      if (msg.type === "ready") {
        seat.ready = true;
        if (room.seats.length === 2 && room.seats.every((s) => s.ready)) {
          beginMatch(room);
        }
        return;
      }

      if (msg.type === "command") {
        if (!room.sim) return;
        room.sim.enqueue(seat.team, msg.command);
      }
    });

    ws.on("close", () => leave(ws));
  });

  return wss;
}
