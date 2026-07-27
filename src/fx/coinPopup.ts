import { Matrix, Scene, Vector3 } from "@babylonjs/core";

interface CoinPopup {
  el: HTMLDivElement;
  world: Vector3;
  age: number;
  life: number;
  rise: number;
}

export interface CoinPopupFx {
  spawn: (world: Vector3, amount: number) => void;
  update: (dt: number, scene: Scene) => void;
  dispose: () => void;
}

/**
 * Floating "+N" coin labels projected from world space into the HUD layer.
 */
export function createCoinPopupFx(): CoinPopupFx {
  const host = document.createElement("div");
  host.className = "coin-popup-layer";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);

  const popups: CoinPopup[] = [];
  const scratch = new Vector3();
  const engine = () => host; // keep host alive for identity

  return {
    spawn: (world, amount) => {
      const el = document.createElement("div");
      el.className = "coin-popup";
      el.textContent = `+${amount}`;
      host.appendChild(el);
      popups.push({
        el,
        world: world.clone(),
        age: 0,
        life: 1.35,
        rise: 0,
      });
      void engine;
    },
    update: (dt, scene) => {
      const engine = scene.getEngine();
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      const cam = scene.activeCamera;
      if (!cam) return;

      for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        p.age += dt;
        p.rise += dt * 1.1;
        if (p.age >= p.life) {
          p.el.remove();
          popups.splice(i, 1);
          continue;
        }

        scratch.set(p.world.x, p.world.y + 1.2 + p.rise, p.world.z);
        const projected = Vector3.Project(
          scratch,
          Matrix.Identity(),
          scene.getTransformMatrix(),
          cam.viewport.toGlobal(w, h),
        );

        const t = p.age / p.life;
        p.el.style.transform = `translate(-50%, -50%) translate(${projected.x}px, ${projected.y}px)`;
        p.el.style.opacity = String(1 - t * t);
      }
    },
    dispose: () => {
      for (const p of popups) p.el.remove();
      popups.length = 0;
      host.remove();
    },
  };
}
