import type { AttackKind, AttackStats } from "./combat";
export interface ComboStage {
  id: string; kind: AttackKind; overrides: Partial<AttackStats>;
  next?: string; inputs?: readonly AttackKind[]; cancel?: readonly [number, number];
}
export interface ComboConfig { bufferTicks: number; stages: readonly ComboStage[] }
export const DEFAULT_COMBO: ComboConfig = {
  bufferTicks: 6,
  stages: [
    { id: "light_1", kind: "light", overrides: {}, next: "light_2", inputs: ["light"], cancel: [9, 11] },
    { id: "light_2", kind: "light", overrides: { recovery: 11, damage: 6, hitstun: 14, knockback: 90, reach: 64 }, next: "light_3", inputs: ["light"], cancel: [9, 11] },
    { id: "light_3", kind: "light", overrides: { startup: 7, recovery: 14, damage: 8, hitstun: 18, knockback: 90, reach: 70 }, next: "finisher", inputs: ["light", "heavy"], cancel: [11, 13] },
    { id: "finisher", kind: "heavy", overrides: {} },
  ],
};
/** Reject cycles and invalid timing before a fighter enters simulation. */
export function validateCombo(config: ComboConfig, attacks: Record<AttackKind, Readonly<AttackStats>>): void {
  if (!Number.isInteger(config.bufferTicks) || config.bufferTicks < 1 || config.bufferTicks > 60 || !config.stages.length || config.stages.length > 4) throw Error("Invalid combo length/buffer");
  const ids = new Set(config.stages.map(s => s.id));
  if (ids.size !== config.stages.length || config.stages[0].kind !== "light") throw Error("Invalid combo IDs/entry");
  config.stages.forEach((s, index) => {
    if (!s.id || !["light", "heavy"].includes(s.kind)) throw Error("Invalid stage");
    const stats = { ...attacks[s.kind], ...s.overrides };
    for (const [key, value] of Object.entries(stats)) {
      if (!Number.isFinite(value) || (key !== "bottom" && value < 0)) throw Error("Invalid attack value");
    }
    for (const key of ["startup", "active", "recovery", "hitstun"] as const)
      if (!Number.isInteger(stats[key]) || stats[key] < 1) throw Error("Invalid attack duration");
    if (!Number.isInteger(stats.cooldown) || stats.cooldown < 0 || stats.reach <= 0 || stats.width <= 0 || stats.height <= 0) throw Error("Invalid attack dimensions/cooldown");
    if (s.next) {
      const nextIndex = config.stages.findIndex(n => n.id === s.next);
      if (nextIndex !== index + 1 || !s.cancel || !s.inputs?.length || s.inputs.some(i => i !== "light" && i !== "heavy")) throw Error("Invalid combo transition");
      const [first,last] = s.cancel;
      if (!Number.isInteger(first) || !Number.isInteger(last) || first <= stats.startup + stats.active || last < first || last > stats.startup + stats.active + stats.recovery) throw Error("Invalid cancel window");
    } else if (index !== config.stages.length - 1 || s.cancel || s.inputs) throw Error("Invalid terminal stage");
  });
}
