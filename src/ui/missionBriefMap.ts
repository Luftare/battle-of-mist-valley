import {
  FLAG_CAPTURE_RADIUS,
  HILL_RADIUS,
  PLAY_DEPTH,
  PLAY_WIDTH,
  SLOT_COUNT,
} from "../game/stats";
import { buildingLineZ } from "../game/slotLayout";

/**
 * Top-down ops map for the title mission brief — meadow, hill contours,
 * dotted rings on friendly / hill / enemy, military paper look.
 */
export function missionBriefMapSvg(): string {
  const vbW = 200;
  const vbH = 292;
  const margin = 14;
  const headerH = 22;
  const footerH = 18;
  const plotX = margin;
  const plotY = margin + headerH;
  const plotW = vbW - margin * 2;
  const plotH = vbH - margin * 2 - headerH - footerH;

  const halfX = PLAY_WIDTH * 0.5;
  const halfZ = PLAY_DEPTH * 0.5;
  const zLine = buildingLineZ(halfZ);

  const sx = plotW / PLAY_WIDTH;
  const sy = plotH / PLAY_DEPTH;
  const tx = (x: number) => plotX + plotW * 0.5 + x * sx;
  const tz = (z: number) => plotY + plotH * 0.5 - z * sy;

  const xMin = -halfX + 2.2;
  const xMax = halfX - 2.2;

  // Build-slot ticks along each base line
  const slotMarks: string[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const t = i / Math.max(1, SLOT_COUNT - 1);
    const x = xMin + (xMax - xMin) * t;
    const w = 4.2;
    const h = 3.4;
    for (const z of [-zLine, zLine]) {
      const cx = tx(x);
      const cy = tz(z);
      const fill = z < 0 ? "#3a6ea5" : "#a53a3a";
      slotMarks.push(
        `<rect x="${(cx - w * 0.5).toFixed(1)}" y="${(cy - h * 0.5).toFixed(1)}" width="${w}" height="${h}" rx="0.4" fill="${fill}" opacity="0.85"/>`,
      );
    }
  }

  // Sparse tree marks (decorative, not gameplay-accurate)
  const trees: string[] = [];
  const treePts: [number, number][] = [
    [-12, -8],
    [-14, 4],
    [-10, 14],
    [11, -10],
    [13, 2],
    [10, 12],
    [-6, -16],
    [7, -18],
    [-8, 18],
    [5, 16],
    [-15, -2],
    [14, -4],
  ];
  for (const [x, z] of treePts) {
    const cx = tx(x);
    const cy = tz(z);
    trees.push(
      `<path d="M${cx.toFixed(1)} ${(cy - 2.4).toFixed(1)} l1.6 3.2 h-3.2 z" fill="#3d5c32" opacity="0.55"/>`,
    );
  }

  // Hill contour rings
  const contours: string[] = [];
  for (const r of [HILL_RADIUS * 0.95, HILL_RADIUS * 0.62, HILL_RADIUS * 0.32]) {
    contours.push(
      `<ellipse cx="${tx(0).toFixed(1)}" cy="${tz(0).toFixed(1)}" rx="${(r * sx).toFixed(1)}" ry="${(r * sy).toFixed(1)}" fill="none" stroke="#5a5540" stroke-width="0.7" opacity="0.45"/>`,
    );
  }

  // Grid lines
  const grid: string[] = [];
  for (let gx = -halfX + 6; gx < halfX; gx += 6) {
    grid.push(
      `<line x1="${tx(gx).toFixed(1)}" y1="${plotY}" x2="${tx(gx).toFixed(1)}" y2="${plotY + plotH}" stroke="#4a4e3a" stroke-width="0.35" opacity="0.28"/>`,
    );
  }
  for (let gz = -halfZ + 7; gz < halfZ; gz += 7) {
    grid.push(
      `<line x1="${plotX}" y1="${tz(gz).toFixed(1)}" x2="${plotX + plotW}" y2="${tz(gz).toFixed(1)}" stroke="#4a4e3a" stroke-width="0.35" opacity="0.28"/>`,
    );
  }

  const baseRx = ((xMax - xMin) * 0.55 + 2) * sx;
  const baseRy = 5.8 * sy;
  const hillR = FLAG_CAPTURE_RADIUS * Math.min(sx, sy);
  const friendlyCy = tz(-zLine);
  const enemyCy = tz(zLine);
  const hillCx = tx(0);
  const hillCy = tz(0);

  return `
<svg class="brief-map-svg" viewBox="0 0 ${vbW} ${vbH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Tactical map of Mist Valley: friendly base south, center hill, enemy base north">
  <defs>
    <pattern id="briefPaperGrain" width="4" height="4" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1.5" r="0.35" fill="#3a3a28" opacity="0.12"/>
      <circle cx="3" cy="3" r="0.25" fill="#2a2a1a" opacity="0.08"/>
    </pattern>
    <linearGradient id="briefMeadow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8a9a68"/>
      <stop offset="50%" stop-color="#7d8f5c"/>
      <stop offset="100%" stop-color="#6f8250"/>
    </linearGradient>
    <radialGradient id="briefHillFill" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#9aab72"/>
      <stop offset="70%" stop-color="#7d8f5c" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#7d8f5c" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Paper sheet -->
  <rect x="1" y="1" width="${vbW - 2}" height="${vbH - 2}" rx="2" fill="#c4c7a4" stroke="#3d3f2e" stroke-width="1.6"/>
  <rect x="1" y="1" width="${vbW - 2}" height="${vbH - 2}" rx="2" fill="url(#briefPaperGrain)"/>
  <rect x="5" y="5" width="${vbW - 10}" height="${vbH - 10}" fill="none" stroke="#5a5c45" stroke-width="0.6" opacity="0.55"/>

  <!-- Header strip -->
  <text x="${margin}" y="${margin + 11}" fill="#2e3024" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="7.5" font-weight="700" letter-spacing="0.12em">SECTOR MV-01</text>
  <text x="${vbW - margin}" y="${margin + 11}" text-anchor="end" fill="#5a3a2a" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="6.5" font-weight="700" letter-spacing="0.08em">OPS BRIEF</text>

  <!-- Playfield -->
  <rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}" fill="url(#briefMeadow)" stroke="#3d3f2e" stroke-width="0.9"/>
  ${grid.join("")}
  <ellipse cx="${hillCx.toFixed(1)}" cy="${hillCy.toFixed(1)}" rx="${(HILL_RADIUS * sx).toFixed(1)}" ry="${(HILL_RADIUS * sy).toFixed(1)}" fill="url(#briefHillFill)"/>
  ${contours.join("")}
  ${trees.join("")}

  <!-- Center flag -->
  <line x1="${hillCx.toFixed(1)}" y1="${(hillCy + 3).toFixed(1)}" x2="${hillCx.toFixed(1)}" y2="${(hillCy - 5).toFixed(1)}" stroke="#3d3f2e" stroke-width="1.1"/>
  <path d="M${hillCx.toFixed(1)} ${(hillCy - 5).toFixed(1)} h6 v3.5 h-6 z" fill="#8a8a82" stroke="#3d3f2e" stroke-width="0.4"/>

  <!-- Base pads -->
  ${slotMarks.join("")}

  <!-- Dotted objective rings -->
  <ellipse class="brief-ring brief-ring--friendly" cx="${tx(0).toFixed(1)}" cy="${friendlyCy.toFixed(1)}" rx="${baseRx.toFixed(1)}" ry="${baseRy.toFixed(1)}" fill="none" stroke="#2a4a6e" stroke-width="1.35" stroke-dasharray="2.8 2.2"/>
  <circle class="brief-ring brief-ring--hill" cx="${hillCx.toFixed(1)}" cy="${hillCy.toFixed(1)}" r="${hillR.toFixed(1)}" fill="none" stroke="#3d3f2e" stroke-width="1.25" stroke-dasharray="2.4 2"/>
  <ellipse class="brief-ring brief-ring--enemy" cx="${tx(0).toFixed(1)}" cy="${enemyCy.toFixed(1)}" rx="${baseRx.toFixed(1)}" ry="${baseRy.toFixed(1)}" fill="none" stroke="#6e2a2a" stroke-width="1.35" stroke-dasharray="2.8 2.2"/>

  <!-- Labels -->
  <text x="${tx(0).toFixed(1)}" y="${(friendlyCy + baseRy + 9).toFixed(1)}" text-anchor="middle" fill="#1e3a55" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="6.2" font-weight="700" letter-spacing="0.06em">FRIENDLY BASE</text>
  <text x="${(hillCx + hillR + 4).toFixed(1)}" y="${(hillCy + 2).toFixed(1)}" fill="#2e3024" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="6" font-weight="700" letter-spacing="0.05em">HILL</text>
  <text x="${tx(0).toFixed(1)}" y="${(enemyCy - baseRy - 4).toFixed(1)}" text-anchor="middle" fill="#551e1e" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="6.2" font-weight="700" letter-spacing="0.06em">ENEMY BASE</text>

  <!-- North arrow -->
  <g transform="translate(${plotX + plotW - 12}, ${plotY + 16})">
    <polygon points="0,-7 3.2,5 -3.2,5" fill="#2e3024"/>
    <text x="0" y="12" text-anchor="middle" fill="#2e3024" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="6" font-weight="700">N</text>
  </g>

  <!-- Scale -->
  <g transform="translate(${margin}, ${vbH - margin - 6})">
    <line x1="0" y1="0" x2="36" y2="0" stroke="#2e3024" stroke-width="1"/>
    <line x1="0" y1="-2.5" x2="0" y2="2.5" stroke="#2e3024" stroke-width="1"/>
    <line x1="36" y1="-2.5" x2="36" y2="2.5" stroke="#2e3024" stroke-width="1"/>
    <text x="18" y="-4" text-anchor="middle" fill="#2e3024" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="5.5">100 m</text>
  </g>
  <text x="${vbW - margin}" y="${vbH - margin - 3}" text-anchor="end" fill="#4a4e3a" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="5.5" letter-spacing="0.04em">TOPO · 1:AO</text>
</svg>`;
}
