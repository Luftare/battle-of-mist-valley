import {
  decodeServer,
  encode,
  type ServerMessage,
} from "./protocol";
import type { Team } from "../theme/colors";

export interface JoinedRoom {
  ws: WebSocket;
  code: string;
  team: Team;
}

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl());
    const timer = window.setTimeout(() => {
      ws.close();
      reject(new Error("Could not reach the match server."));
    }, 8000);
    ws.addEventListener("open", () => {
      window.clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener("error", () => {
      window.clearTimeout(timer);
      reject(new Error("Could not reach the match server."));
    });
  });
}

function waitForRoom(ws: WebSocket): Promise<JoinedRoom> {
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      const msg: ServerMessage | null = decodeServer(ev.data);
      if (!msg) return;
      if (msg.type === "error") {
        cleanup();
        reject(new Error(msg.message));
        return;
      }
      if (msg.type === "room") {
        cleanup();
        resolve({ ws, code: msg.code, team: msg.team });
      }
    };
    const cleanup = () => ws.removeEventListener("message", onMessage);
    ws.addEventListener("message", onMessage);
  });
}

export async function createRoom(): Promise<JoinedRoom> {
  const ws = await connect();
  const pending = waitForRoom(ws);
  ws.send(encode({ type: "create" }));
  return pending;
}

export async function joinRoom(code: string): Promise<JoinedRoom> {
  const ws = await connect();
  const pending = waitForRoom(ws);
  ws.send(encode({ type: "join", code: code.trim().toUpperCase() }));
  return pending;
}

/** Resolves once both seats are filled. No-op if already full. */
export function waitUntilFull(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      const msg: ServerMessage | null = decodeServer(ev.data);
      if (!msg) return;
      if (msg.type === "error") {
        cleanup();
        reject(new Error(msg.message));
        return;
      }
      if (msg.type === "room" && msg.seats.blue && msg.seats.red) {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("close", onClose);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Disconnected."));
    };
    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
  });
}
