export type Team = "blue" | "red";

export interface TeamPalette {
  primary: string;
  secondary: string;
  accent: string;
  dark: string;
}

export const TEAM_COLORS: Record<Team, TeamPalette> = {
  blue: {
    primary: "#3a6ea5",
    secondary: "#6aa8d8",
    accent: "#c5e0f5",
    dark: "#1e3a55",
  },
  red: {
    primary: "#a53a3a",
    secondary: "#d86a6a",
    accent: "#f5c5c5",
    dark: "#551e1e",
  },
};

/** Shared earthy / blocky materials for terrain and neutral parts. */
export const WORLD_COLORS = {
  grass: "#4f8a3a",
  grassDark: "#3a6b2c",
  grassLight: "#6aad4a",
  dirt: "#6b4f32",
  bark: "#5a3d28",
  barkDark: "#3d2918",
  foliage: "#2f6b28",
  foliageLight: "#4a9438",
  rock: "#7a7a72",
  rockDark: "#55554e",
  rockLight: "#9a9a90",
  metal: "#4a4a48",
  metalDark: "#2e2e2c",
  skin: "#c4a882",
  helmet: "#3d4a3a",
};
