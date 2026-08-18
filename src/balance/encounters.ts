import type { CombatUnitKind } from "../game/stats";

export interface EncounterPreset {
  id: string;
  label: string;
  blue: CombatUnitKind[];
  red: CombatUnitKind[];
}

export const ENCOUNTER_PRESETS: EncounterPreset[] = [
  {
    id: "mirror-rifle",
    label: "Rifle vs Rifle",
    blue: ["rifleman"],
    red: ["rifleman"],
  },
  {
    id: "mirror-tank",
    label: "Tank vs Tank",
    blue: ["tank"],
    red: ["tank"],
  },
  {
    id: "mirror-heli",
    label: "Heli vs Heli",
    blue: ["helicopter"],
    red: ["helicopter"],
  },
  {
    id: "rifle-tank",
    label: "Rifle vs Tank",
    blue: ["rifleman"],
    red: ["tank"],
  },
  {
    id: "rifle-heli",
    label: "Rifle vs Heli",
    blue: ["rifleman"],
    red: ["helicopter"],
  },
  {
    id: "tank-heli",
    label: "Tank vs Heli",
    blue: ["tank"],
    red: ["helicopter"],
  },
  {
    id: "rifle-vs-armor-air",
    label: "Rifle vs Tank + Heli",
    blue: ["rifleman"],
    red: ["tank", "helicopter"],
  },
  {
    id: "ground-vs-heli",
    label: "Rifle + Tank vs Heli",
    blue: ["rifleman", "tank"],
    red: ["helicopter"],
  },
  {
    id: "rifle-heli-vs-tank",
    label: "Rifle + Heli vs Tank",
    blue: ["rifleman", "helicopter"],
    red: ["tank"],
  },
  {
    id: "mixed",
    label: "Rifle + Tank vs Rifle + Heli",
    blue: ["rifleman", "tank"],
    red: ["rifleman", "helicopter"],
  },
  {
    id: "full",
    label: "All vs All",
    blue: ["rifleman", "tank", "helicopter"],
    red: ["rifleman", "tank", "helicopter"],
  },
];
