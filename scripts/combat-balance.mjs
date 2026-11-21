import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadCore } from './core-loader.mjs';
const load = await loadCore();
const C = await load('core/combat'), L = await load('core/cpu'), P = await load('core/projectiles'), M = await load('core/movement');
const { CombatTelemetry } = await load('dev/combat-telemetry');
const refined = process.argv.includes('--baseline') ? null : await load('core/cpu-policy');
const quick = process.argv.includes('--quick'), holdout = process.argv.includes('--holdout'), check = process.argv.includes('--check'), seeds = Array.from({ length: quick ? 5 : holdout ? 25 : 100 }, (_, i) => i + (holdout ? 100 : 0)), cap = 10800;
const scenarios = ['idle', 'lights', 'heavy', 'combo', 'guard', 'projectiles', 'rotate', 'corner'];
const orientations = quick ? ['e', 's'] : ['e', 's', 'w', 'n'];
if (process.argv.includes('--baseline')) {
    try {
        await readFile('reports/M02.4-baseline.json');
        throw Error('Recorded baseline is immutable; use the paired legacy comparison instead');
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
}
const rows = [], telemetryGroups = {};
for (const policy of refined ? ['legacy', 'refined'] : ['legacy'])
    for (const difficulty of ['Easy', 'Normal', 'Hard'])
        for (const scenario of scenarios)
            for (const seed of seeds)
                for (const facing of orientations)
                    for (const side of [0, 1]) {
                        const d = C.facingVector(facing), opposite = M.DIRECTIONS[(M.DIRECTIONS.indexOf(facing) + 4) % 8];
                        const a = C.createCombatFighter('cpu', -d.x * 70, -d.y * 70, facing), b = C.createCombatFighter('player', d.x * 70, d.y * 70, opposite);
                        if (scenario === 'corner') {
                            b.x = side ? 324 : -324;
                            b.y = side ? 194 : -194;
                            a.x = b.x - d.x * 35;
                            a.y = b.y - d.y * 35;
                            a.x = Math.max(-324, Math.min(324, a.x));
                            a.y = Math.max(-194, Math.min(194, a.y));
                        }
                        else if (side) {
                            for (const f of [a, b]) {
                                f.x = -f.x;
                                f.y = -f.y;
                                f.facing = M.DIRECTIONS[(M.DIRECTIONS.indexOf(f.facing) + 4) % 8];
                            }
                        }
                        const world = P.createCombatState(), cpu = policy === 'legacy' ? new L.CpuController(L.CPU_PRESETS[difficulty], seed) : new refined.RefinedCpuController(L.CPU_PRESETS[difficulty], seed, difficulty);
                        const telemetry = new CombatTelemetry("cpu");
                        let dealt = 0, taken = 0, stagnant = 0, longest = 0, previousDistance = Math.hypot(a.x - b.x, a.y - b.y);
                        for (let tick = 0; tick < cap; tick++) {
                            const x = cpu.tick(a, b, world), y = { ...M.NO_INPUT };
                            const approach = L.pursuitInput(b, a);
                            if (scenario !== 'idle' && scenario !== 'guard' && scenario !== 'projectiles')
                                Object.assign(y, approach);
                            if (scenario === 'lights' || scenario === 'corner')
                                y.attack = 'light';
                            if (scenario === 'heavy')
                                y.attack = 'heavy';
                            if (scenario === 'combo')
                                y.attack = 'light';
                            if (scenario === 'guard')
                                y.block = true;
                            if (scenario === 'projectiles')
                                y.special = 'projectile';
                            if (scenario === 'rotate') {
                                if (tick % 60 === 0)
                                    y.special = ['power', 'dash', 'projectile'][Math.floor(tick / 60) % 3];
                                else
                                    y.attack = 'light';
                            }
                            const events = C.stepCombat([a, b], [x, y], world, telemetry.accepted);
                            cpu.recordOutcomes?.(events);
                            telemetry.observe([a, b], events, cpu.lastDecision?.reason ?? 'legacy', world.projectiles);
                            dealt += events.filter(e => e.attackerId === 'cpu').reduce((n, e) => n + e.damage, 0);
                            taken += events.filter(e => e.defenderId === 'cpu').reduce((n, e) => n + e.damage, 0);
                            const distance = Math.hypot(a.x - b.x, a.y - b.y);
                            const progress = events.length || distance < previousDistance - .05 || a.action.type === 'attack' || a.action.type === 'special';
                            stagnant = progress ? 0 : stagnant + 1;
                            longest = Math.max(longest, stagnant);
                            previousDistance = distance;
                            if (a.health === 0 || b.health === 0)
                                break;
                        }
                        const t = telemetry.summary();
                        const key = [policy, difficulty, scenario].join('/');
                        const detail = telemetryGroups[key] ??= { cases: 0, ticks: 0, interrupted: 0, completedWhiffs: 0, attempts: {}, hits: {}, damage: {}, damageTaken: {}, occupancy: {}, decisions: {} };
                        detail.cases++;
                        detail.ticks += t.ticks;
                        detail.interrupted += t.interrupted;
                        detail.completedWhiffs += t.completedWhiffs;
                        for (const metric of ['attempts', 'hits', 'damage', 'damageTaken', 'occupancy', 'decisions'])
                            for (const [kind, value] of Object.entries(t[metric]))
                                detail[metric][kind] = (detail[metric][kind] ?? 0) + value;
                        const attempts = Object.values(t.attempts).reduce((a, b) => a + b, 0);
                        rows.push({ policy, difficulty, scenario, seed, facing, side, ticks: t.ticks, censored: t.ticks === cap, winner: a.health === b.health ? 'draw' : a.health > b.health ? 'cpu' : 'player',
                            dealt, taken, whiffs: t.completedWhiffs, attempts, blocks: t.blocks, breaks: t.breaks, longestNoProgress: longest, damage: t.damage, occupancy: t.occupancy, guardConsumed: t.guardConsumed, guardRegenerated: t.guardRegenerated, guardRefilled: t.guardRefilled, damageTaken: t.damageTaken, decisions: t.decisions, receivedBlocks: t.receivedBlocks, receivedBreaks: t.receivedBreaks });
                    }
function summarize(selected) {
    const median = x => { const a = x.slice().sort((a, b) => a - b); return a[Math.floor(a.length / 2)] ?? 0; };
    return { cases: selected.length,
        medianTicks: median(selected.map(r => r.ticks)), p95Ticks: selected.map(r => r.ticks).sort((a, b) => a - b)[Math.floor(selected.length * .95)] ?? 0,
        meanDamageTaken: selected.reduce((n, r) => n + r.taken, 0) / selected.length, meanDamageDealt: selected.reduce((n, r) => n + r.dealt, 0) / selected.length,
        whiffRate: selected.reduce((n, r) => n + r.whiffs, 0) / Math.max(1, selected.reduce((n, r) => n + r.attempts, 0)),
        cpuWins: selected.filter(r => r.winner === 'cpu' && !r.censored).length, censored: selected.filter(r => r.censored).length,
        noProgress180: selected.filter(r => r.longestNoProgress >= 180).length, blocks: selected.reduce((n, r) => n + r.blocks, 0), breaks: selected.reduce((n, r) => n + r.breaks, 0) };
}
const groups = {};
for (const policy of refined ? ['legacy', 'refined'] : ['legacy'])
    for (const difficulty of ['Easy', 'Normal', 'Hard'])
        for (const scenario of scenarios)
            groups[[policy, difficulty, scenario].join('/')] = summarize(rows.filter(r => r.policy === policy && r.difficulty === difficulty && r.scenario === scenario));
const summary = { baseline: 'f7ccb1d430be31216811392df9c57345e9a3f309', schema: 2, quick, seeds: seeds.length, orientations, sideSwaps: true, cap,
    rowsHash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), summary: groups };
if (refined) {
    const baseline = JSON.parse(await readFile('reports/M02.4-baseline.json', 'utf8'));
    summary.baselineCombatReproduced = holdout ? null : Object.keys(baseline.summary).every(k => Object.keys(baseline.summary[k]).filter(metric => metric !== 'whiffRate').every(metric => baseline.summary[k][metric] === groups[k][metric]));
    summary.baselineMeasurementCorrection = 'Schema 1 omitted special acceptance notifications; preserved original baseline. Schema 2 reruns both policies with complete accepted-special accounting. All original combat metrics must reproduce; whiff-rate accounting is corrected.';
    const totals = policy => summarize(rows.filter(r => r.policy === policy));
    summary.totals = { legacy: totals('legacy'), refined: totals('refined') };
    const before = summary.totals.legacy, after = summary.totals.refined;
    const zoning = policy => summarize(rows.filter(r => r.policy === policy && r.scenario === 'projectiles'));
    summary.projectileSuite = { legacy: zoning('legacy'), refined: zoning('refined') };
    const pairs = [];
    for (let i = 0; i < rows.length / 2; i++)
        pairs.push(rows[i + rows.length / 2].taken - rows[i].taken);
    const mean = pairs.reduce((a, b) => a + b, 0) / pairs.length, se = Math.sqrt(pairs.reduce((a, b) => a + (b - mean) ** 2, 0) / (pairs.length - 1) / pairs.length);
    summary.pairedDamageDelta = { mean, normal95: [mean - 1.96 * se, mean + 1.96 * se], note: 'Descriptive paired normal interval; orientations share seeds and are not independent human trials' };
    summary.extraMetrics = {};
    for (const policy of ['legacy', 'refined']) {
        const selected = rows.filter(r => r.policy === policy);
        summary.extraMetrics[policy] = {};
        for (const key of ['guardConsumed', 'guardRegenerated', 'guardRefilled', 'receivedBlocks', 'receivedBreaks'])
            summary.extraMetrics[policy][key] = selected.reduce((n, r) => n + r[key], 0);
    }
    summary.gates = { whiffReduction20: after.whiffRate <= before.whiffRate * .8, damageReduction20: after.meanDamageTaken <= before.meanDamageTaken * .8,
        durationIncreaseAtMost10: after.medianTicks <= before.medianTicks * 1.1, noProgress180: after.noProgress180 === 0,
        projectileDamageReduction20: summary.projectileSuite.refined.meanDamageTaken <= summary.projectileSuite.legacy.meanDamageTaken * .8, projectileDurationAtMost10: summary.projectileSuite.refined.medianTicks <= summary.projectileSuite.legacy.medianTicks * 1.1,
        difficultyOrdering: ['Easy', 'Normal', 'Hard'].map(d => summarize(rows.filter(r => r.policy === 'refined' && r.difficulty === d)).cpuWins) };
}
const evidenceDir=holdout?'artifacts/balance/holdout':'artifacts/balance/primary';
await mkdir(evidenceDir, { recursive: true });
await writeFile(evidenceDir+'/rows.json', JSON.stringify(rows));
await writeFile(evidenceDir+'/telemetry.json', JSON.stringify(telemetryGroups, null, 2));
const recorded = holdout ? 'reports/M02.4-holdout.json' : 'reports/M02.4-comparison.json';
if (refined && !holdout && !summary.baselineCombatReproduced)
    throw Error('Legacy combat baseline changed');
if (check) {
    const expected = JSON.parse(await readFile(recorded, 'utf8'));
    if (JSON.stringify(expected) !== JSON.stringify(summary))
        throw Error('Deterministic balance report differs from committed evidence');
}
const output = process.argv.includes('--baseline') ? 'reports/M02.4-baseline.json' : check ? evidenceDir+'/comparison.json' : recorded;
await writeFile(output, JSON.stringify(summary, null, 2) + '\n');
console.log(output, JSON.stringify(summary.totals ?? { cases: rows.length }));
