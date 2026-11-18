// Token Launch Radar, model radar-3 (Node 22, standard library only).
//
// implied value = exp(intercept + slope x ln(TVL)), a log-log size curve fitted
// at run time by lib/model.ts to the snapshot's live-token protocols (intercept 7.7881, slope
// 0.4721 on the sealed snapshot, n = 119). The program reads the snapshot from /input/snapshot.json
// (or --input <file|dir>), scores every pre-token protocol, writes the ranked board (198 rows:
// 40 watchlist + 158 early) to /output/board.json, and copies this repository's dashboard/ and
// screenshots/ to /output. Last it writes /output/dossier.json, the summary the judge reads, with
// the vendored make.fun library. Implied value is a model, not a promise: a protocol with no token
// records no token, and a high implied value is a farm plan, not a valuation. Re-runs are
// deterministic: the same snapshot writes the same /output byte for byte.
//
// The dashboard is a static, fully offline page: dashboard/index.html, dashboard/app.css and
// dashboard/app.js read /output/data.js, written here from the same board. Every row carries a
// six-step farm plan, and the detail view shows that row's model equation.
//
// Local runs use MAKEFUN_OUTPUT_DIR in place of /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write('usage: node main.ts --input <snapshot.json|directory> [--output <dir>]\n');
  process.stdout.write('  --input   sealed snapshot file or the directory holding snapshot.json\n');
  process.stdout.write('  --output  directory for board.json, data.js, dashboard, screenshots and dossier.json\n');
  process.exit(0);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot: ReturnType<typeof parseSnapshot>;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (error) {
  process.stderr.write(`token radar: cannot read ${inputFile}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
if (!snapshot || !Array.isArray(snapshot.protocols) || snapshot.protocols.length === 0) {
  process.stderr.write('token radar: the snapshot holds no protocols to score\n');
  process.exit(1);
}
const { board, radar } = buildRadar(snapshot);
if (board.length === 0) {
  process.stderr.write('token radar: the model scored no rows: the snapshot holds no pre-token protocol to rank\n');
  process.exit(1);
}
for (let i = 1; i < board.length; i++) {
  if (board[i].implied_value_usd > board[i - 1].implied_value_usd) {
    process.stderr.write(`token radar: the board is not ranked: row ${i + 1} outranks row ${i}\n`);
    process.exit(1);
  }
}
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const boardPath = join(out, 'board.json');
writeFileSync(boardPath, `${JSON.stringify({ rows: board })}\n`);
if (statSync(boardPath).size === 0) {
  process.stderr.write('token radar: board.json came out empty\n');
  process.exit(1);
}
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  const bytes = readFileSync(join(here, 'screenshots', name));
  const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isPng) {
    process.stderr.write(`token radar: screenshots/${name}: not a PNG image\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossierPath = join(out, 'dossier.json');
writeFileSync(dossierPath, buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
if (statSync(dossierPath).size === 0) {
  process.stderr.write('token radar: dossier.json came out empty\n');
  process.exit(1);
}

/** Whole dollars with thousands separators, for the summary lines. */
function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US')}`;
}

/** Run summary on stdout: counts, outputs, top rows, and the model calibration. */
function summarize(): void {
  process.stdout.write(`token radar: model radar-3, log-log fit intercept ${radar.model.intercept} slope ${radar.model.slope} on ${radar.model.comp_count} live-token comps\n`);
  process.stdout.write(`token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n`);
  process.stdout.write(`token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`);
  const topTen = board.slice(0, 10).reduce((sum, row) => sum + row.implied_value_usd, 0);
  process.stdout.write(`token radar: top 10 combined ${formatUsd(topTen)}\n`);
  for (const row of board.slice(0, 3)) {
    process.stdout.write(`token radar: #${row.rank} ${row.name} ${formatUsd(row.implied_value_usd)}\n`);
  }
}

summarize();
