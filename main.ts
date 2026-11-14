// Token Radar entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores it with lib/model.ts, and writes the
// graded outputs:
//
//   board.json    the ranked board (every pre-token protocol, watchlist covered)
//   data.js       the same board, compact, for the static dashboard
//   dashboard/    the page itself (index.html + app.css + app.js)
//   screenshots/  three renders of the page (board, detail, filtered)
//   dossier.json  the judge's dossier, built by vendor/makefun-board.ts
//
// Run outside the grader with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//
// Inside the grader the snapshot lives at /input/snapshot.json and the
// outputs go to /output. The program never touches the network, never
// writes outside the output directory, and runs twice to the same bytes:
// the board is fully deterministic (ties break on slug, floats are rounded
// before they are written).

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardProblem, buildBoard, parseSnapshot, payloadScript, TUNING } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TEXT_CAP = 65536;
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flagValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === `--${name}` && i + 1 < args.length) return args[i + 1]!;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

function fail(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

const inputGiven = flagValue('input', '/input');
const inputPath = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(inputPath)) {
  fail(`no snapshot at ${inputPath} — pass --input <snapshot.json or its directory>`);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const doc = parseSnapshot(readFileSync(inputPath, 'utf8'));
const { rows, payload } = buildBoard(doc, TUNING);
const problem = boardProblem(rows, doc);
if (problem !== null) fail(`board failed its own check: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows, model: payload.modelVersion, as_of: payload.asOf }) + '\n');
writeFileSync(join(outDir, 'data.js'), payloadScript(payload));

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyDir(join(ROOT, 'dashboard'), join(outDir, 'dashboard'));
if (!dashFiles.includes('index.html')) fail('dashboard/index.html is missing');
if (!dashFiles.some((f) => f.endsWith('.css'))) fail('dashboard has no .css file');
if (!dashFiles.some((f) => f.endsWith('.js'))) fail('dashboard has no .js file');

const shots = copyDir(join(ROOT, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length !== 3) fail(`screenshots/ must hold exactly 3 images, found ${shots.length}`);
for (const name of shots) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name} has a name the dossier refuses`);
  if (!/\.(png|jpg|jpeg)$/i.test(name)) fail(`screenshots/${name} is not a PNG or JPEG`);
}

const dossier = buildDossier(outDir, {
  text_max_bytes: TEXT_CAP,
  screenshots: { max: 4, max_bytes: 524288 },
  dashboard: { max_files: 400, max_bytes: 4194304 },
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

process.stdout.write(
  `token-radar: ${doc.protocols.length} protocols in snapshot, ${doc.watchlist.length} on watchlist\n` +
    `token-radar: board ${rows.length} rows, top ${rows[0]!.slug} $${rows[0]!.implied_value_usd.toLocaleString('en-US')} implied, ` +
    `live list ${payload.liveSize} protocols\n` +
    `token-radar: wrote board.json, data.js, dashboard (${dashFiles.length} files), ` +
    `screenshots (${shots.length} images), dossier.json (${dossier.length} bytes)\n`,
);
