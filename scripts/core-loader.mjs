import ts from 'typescript';
import { readdir, readFile, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
/** Compile only pure TS modules in an isolated temporary directory; no new runtime dependencies. */
export async function loadCore() {
    const root = await mkdtemp(join(tmpdir(), 'combat-balance-'));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    for (const dir of ['core', 'dev']) {
        await mkdir(join(root, dir), { recursive: true });
        for (const file of await readdir(resolve('src', dir))) {
            if (!file.endsWith('.ts'))
                continue;
            let output = ts.transpileModule(await readFile(resolve('src', dir, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
            output = output.replace(/(from\s*["'])(\.{1,2}\/[^"']+)(["'])/g, (_, a, p, b) => a + p + '.js' + b);
            await writeFile(join(root, dir, file.replace(/\.ts$/, '.js')), output);
        }
    }
    return async (file) => import(pathToFileURL(join(root, file + '.js')).href);
}
