import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { loadCore } from './core-loader.mjs';
const load = await loadCore(), { MatchController } = await load('core/match');
const rows = [];
for (const policy of ['legacy', 'refined'])
    for (const difficulty of ['Easy', 'Normal', 'Hard'])
        for (const seed of [0, 1, 5, 42, 255])
            for (const scenario of ['idle', 'pressure', 'projectiles']) {
                const m = new MatchController(seed, policy);
                m.selectDifficulty(difficulty);
                m.start();
                let total = 0, fighting = 0;
                for (; total < 72000 && m.state !== 'Match Over'; total++) {
                    if (m.state === 'Fighting') {
                        fighting++;
                        if (scenario === 'pressure') {
                            for (const code of ['KeyJ', 'KeyK']) {
                                m.press(code);
                                m.release(code);
                            }
                        }
                        if (scenario === 'projectiles') {
                            m.press('Digit3');
                            m.release('Digit3');
                            m.press('KeyI');
                            m.release('KeyI');
                        }
                    }
                    m.tick();
                }
                rows.push({ policy, difficulty, seed, scenario, totalTicks: total, fightingTicks: fighting, state: m.state, score: m.score, winner: m.winner });
            }
const summary = { schema: 1, cap: 72000, rows };
await mkdir('artifacts/balance', { recursive: true });
if (process.argv.includes('--check')) {
    if (JSON.stringify(JSON.parse(await readFile('reports/M02.4-matches.json', 'utf8'))) !== JSON.stringify(summary))
        throw Error('Full-match replay mismatch');
}
else
    await writeFile('reports/M02.4-matches.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ matches: rows.length, completed: rows.filter(r => r.state === 'Match Over').length }));
