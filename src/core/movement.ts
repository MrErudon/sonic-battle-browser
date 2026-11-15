import { ARENA, projectArena } from "./arena";

export const STEP = 1 / 60;
export const DIRECTIONS = ["e", "se", "s", "sw", "w", "nw", "n", "ne"] as const;
export type Facing = typeof DIRECTIONS[number];
export type MovementState = "idle" | "walk" | "jump" | "landing";
export interface MovementConfig {
  speed: number;
  airControl: number;
  jumpSpeed: number;
  gravity: number;
  radius: number;
  landingFrames: number;
}
export const DEFAULT_MOVEMENT: Readonly<MovementConfig> = {
  speed: 220, airControl: 0.7, jumpSpeed: 360, gravity: 1000,
  radius: 16, landingFrames: 6,
};
export interface Fighter {
  x: number; y: number; z: number; vz: number;
  facing: Facing;
  state: MovementState;
  landingRemaining: number;
}
/** Directions are screen-relative; jump is a press edge, not a held button. */
export interface MovementInput { x: number; y: number; jump: boolean }
export const NO_INPUT: Readonly<MovementInput> = { x: 0, y: 0, jump: false };
export function createFighter(x: number, y: number, facing: Facing = "s"): Fighter {
  return { x, y, z: 0, vz: 0, facing, state: "idle", landingRemaining: 0 };
}

/** Advance exactly one 60 Hz tick. No rendering or keyboard dependencies. */
export function stepFighter(f: Fighter, input: MovementInput, config = DEFAULT_MOVEMENT): void {
  if (f.landingRemaining > 0) {
    f.landingRemaining--;
    if (f.landingRemaining > 0) return;
    f.state = "idle";
  }
  const sx = Math.sign(input.x), sy = Math.sign(input.y);
  if (sx || sy) {
    const index = (Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) + 8) % 8;
    f.facing = DIRECTIONS[index];
  }
  if (input.jump && f.z === 0 && f.state !== "jump") {
    f.vz = config.jumpSpeed;
    f.state = "jump";
  }
  const airborne = f.state === "jump";
  // Invert the arena projection, then normalize in logical arena units.
  const dx = sx / 0.65 + sy / 0.32;
  const dy = sy / 0.32 - sx / 0.65;
  const length = Math.hypot(dx, dy);
  const distance = config.speed * (airborne ? config.airControl : 1) * STEP;
  const oldX = f.x, oldY = f.y;
  const limitX = ARENA.width / 2 - config.radius;
  const limitY = ARENA.depth / 2 - config.radius;
  f.x = Math.max(-limitX, Math.min(limitX, f.x + (length ? dx / length * distance : 0)));
  f.y = Math.max(-limitY, Math.min(limitY, f.y + (length ? dy / length * distance : 0)));
  if (airborne) {
    f.z += f.vz * STEP - 0.5 * config.gravity * STEP * STEP;
    f.vz -= config.gravity * STEP;
    if (f.z <= 0) {
      f.z = 0;
      f.vz = 0;
      f.landingRemaining = config.landingFrames;
      f.state = config.landingFrames > 0 ? "landing" : "idle";
    }
  } else {
    f.state = f.x !== oldX || f.y !== oldY ? "walk" : "idle";
  }
}

export function projectFighter(f: Fighter) {
  const ground = projectArena(f.x, f.y);
  return { x: ground.x, y: ground.y - f.z, groundY: ground.y, depth: ground.y };
}
