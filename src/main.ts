import { Engine } from "@babylonjs/core";
import { createGameWorld, type GameWorld } from "./game/createGameWorld";
import { createOnboardingWorld } from "./game/createOnboardingWorld";
import {
  applyMobilePixelCap,
  isMobileDevice,
  MOBILE_TARGET_FPS,
} from "./platform/mobile";
import { staticThumbMap } from "./thumbs";
import { showBuildIntro } from "./ui/buildIntro";
import { showOnboarding } from "./ui/onboarding";
import { showMultiplayerLobby, showRoomWaiting } from "./ui/multiplayerLobby";
import { createRemoteDriver } from "./net/remoteDriver";
import { createRoom, joinRoom, waitUntilFull } from "./net/roomClient";
import type { MatchDriver } from "./sim/driver";

const canvas = document.getElementById("renderCanvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing #renderCanvas");
}
const renderCanvas: HTMLCanvasElement = canvas;

const hudEl = document.getElementById("hud");
if (hudEl) hudEl.hidden = true;

const isMobile = isMobileDevice();
const engine = new Engine(renderCanvas, !isMobile, {
  preserveDrawingBuffer: false,
  stencil: false,
  adaptToDeviceRatio: true,
  powerPreference: isMobile ? "low-power" : "high-performance",
});
applyMobilePixelCap(engine);
if (isMobile) engine.maxFPS = MOBILE_TARGET_FPS;

let loopActive = false;
let gamePaused = true;
let activeScene: { render: () => void } | null = null;
let game: GameWorld | null = null;

function startRenderLoop(): void {
  if (loopActive || document.hidden) return;
  if (game && gamePaused) return;
  if (!activeScene) return;
  loopActive = true;
  engine.runRenderLoop(() => {
    activeScene?.render();
  });
}

function stopRenderLoop(): void {
  if (!loopActive) return;
  loopActive = false;
  engine.stopRenderLoop();
}

function launchMatch(driver?: MatchDriver): void {
  stopRenderLoop();
  onboarding.dispose();

  game = createGameWorld(engine, renderCanvas, driver ? { driver } : undefined);
  game.setThumbs(staticThumbMap());
  game.beginIntro();
  activeScene = game.scene;

  const baseSetPaused = game.setPaused.bind(game);
  game.setPaused = (paused: boolean) => {
    gamePaused = paused;
    baseSetPaused(paused);
    if (paused) stopRenderLoop();
    else startRenderLoop();
  };

  if (hudEl) hudEl.hidden = false;
  game.setPaused(false);

  showBuildIntro({
    onConfirm: () => {
      game?.confirmIntro();
    },
  });
}

const onboarding = createOnboardingWorld(engine, renderCanvas);
activeScene = onboarding.scene;
gamePaused = false;
startRenderLoop();

function showLobby(): void {
  showMultiplayerLobby({
    onVsAi: () => launchMatch(),
    onCreate: () => {
      void (async () => {
        try {
            const joined = await createRoom();
            const full = waitUntilFull(joined.ws);
            const waiting = showRoomWaiting({
              code: joined.code,
              onCancel: () => {
                joined.ws.close();
              },
            });
            await full;
          waiting.dispose();
          launchMatch(
            createRemoteDriver({
              ws: joined.ws,
              localTeam: joined.team,
              roomCode: joined.code,
            }),
          );
        } catch (err) {
          window.alert(err instanceof Error ? err.message : "Could not create room.");
          showLobby();
        }
      })();
    },
    onJoin: (code) => {
      void (async () => {
        try {
          const joined = await joinRoom(code);
          launchMatch(
            createRemoteDriver({
              ws: joined.ws,
              localTeam: joined.team,
              roomCode: joined.code,
            }),
          );
        } catch (err) {
          window.alert(err instanceof Error ? err.message : "Could not join room.");
          showLobby();
        }
      })();
    },
  });
}

showOnboarding({
  onDismiss: () => {
    showLobby();
  },
});

const onResize = () => {
  engine.resize();
  applyMobilePixelCap(engine);
};
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopRenderLoop();
  else startRenderLoop();
});

window.addEventListener("pagehide", stopRenderLoop);
window.addEventListener("pageshow", () => {
  if (!game || !gamePaused) startRenderLoop();
});
