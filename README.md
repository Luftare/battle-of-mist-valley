# Auto Battler 3D

Web-based auto battler prototype built with [Babylon.js](https://www.babylonjs.com/).
Blocky-realism visual style; mobile-first.

## Lab view

The current build is a **lab view** for reviewing terrain and unit models/animations:

- Meadow terrain (grass, trees, rocks) with idle sway
- Rifleman, Tank, Helicopter — blue and red teams
- Angled bird's-eye camera (drag to orbit, pinch/scroll to zoom)

## Balance lab

Open `/balance.html` for a flat sandbox that sizes armies from **building cost × spawn interval** (smallest integer mix at 0.9 resource balance). Mix unit types per side, toggle Hellfire missiles, and re-run fights.

## Develop

```bash
npm install
npm run dev
```

Open the printed local URL (works on phone over LAN via `host: true`).

## Build

```bash
npm run build
npm run preview
```
