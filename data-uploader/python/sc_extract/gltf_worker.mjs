// Long-lived @gltf-transform/cli runner for the 3D export (hull3d.GltfWorker).
//
// Every part of a ship is two optimizer calls (optimize, meshopt); a fresh
// Node process per call spent ~0.6 s of its ~0.65 s starting up and loading
// the CLI — about a minute per ship with new parts. This process loads the CLI
// once and runs each command through the CLI's own command table, so the
// output is byte-identical to `node cli.js <args>` by construction.
//
//   node gltf_worker.mjs <path to @gltf-transform/cli/bin/cli.js>
//   stdin : one JSON array of CLI args per line, e.g. ["meshopt","in.glb","out.glb"]
//   stdout: one JSON object per line, {"ok":true} or {"ok":false,"error":"…"}
//
// The CLI's own console output goes to stderr (the caller discards it), so
// stdout carries nothing but the replies.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const cliPath = process.argv[2];

/** The ESM entry Node's own `import` would pick for ``name`` from ``fromFile``
 * — the same file, hence the same module instance, the CLI imported. */
function esmEntry(name, fromFile) {
  for (let dir = dirname(fromFile); ; dir = dirname(dir)) {
    const pkgDir = join(dir, 'node_modules', ...name.split('/'));
    if (existsSync(join(pkgDir, 'package.json'))) {
      const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
      const exp = pkg.exports && (pkg.exports['.'] ?? pkg.exports);
      const entry = (typeof exp === 'string' ? exp : exp && (exp.import ?? exp.default))
        ?? pkg.module ?? pkg.main ?? 'index.js';
      return join(pkgDir, typeof entry === 'string' ? entry : entry.default);
    }
    if (dirname(dir) === dir) throw new Error(`cannot resolve ${name} from ${fromFile}`);
  }
}
// Everything the CLI prints (task list, "a.glb → b.glb", prune notes) goes to
// stderr; stdout carries the replies only.
const writeReply = process.stdout.write.bind(process.stdout);
const reply = (msg) => writeReply(JSON.stringify(msg) + '\n');
process.stdout.write = process.stderr.write.bind(process.stderr);
for (const k of ['log', 'info', 'debug']) console[k] = (...a) => console.error(...a);
process.env.NODE_ENV = 'test'; // listr2: silent renderer, no TTY redraws

const distUrl = pathToFileURL(cliPath.replace(/bin[\\/]cli\.js$/, 'dist/cli.mjs')).href;
const { programReady } = await import(distUrl);
await programReady;
// The CLI wraps a caporal program that is a module singleton; its run(argv)
// resolves when the command's action has finished (the wrapper's run() does
// not return that promise).
const { program } = await import(pathToFileURL(esmEntry('@donmccurdy/caporal', cliPath)).href);

reply({ ready: true });
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  try {
    const argv = JSON.parse(line);
    process.exitCode = 0;
    await program.run(argv);
    if (process.exitCode) throw new Error(`exit code ${process.exitCode}`);
    reply({ ok: true });
  } catch (err) {
    reply({ ok: false, error: String((err && err.message) || err).slice(0, 2000) });
  } finally {
    process.exitCode = 0;
  }
}
