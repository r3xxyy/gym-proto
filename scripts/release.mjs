// One command to publish to Expo Go:  npm run release  [-- --message "what changed"]
//
// It refuses to publish unless the code is committed, typechecks, lints, passes the logic checks and a
// trial export actually contains the Gemini key and this build's ID. After publishing it confirms Expo
// is serving the new update, then opens a QR code for it. Each step prints what it checked.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// tsc errors that already existed in the repo (expo-router colour types, TextInput refs). New ones fail the release.
// Lower this number when those are fixed.
const TSC_BASELINE = 5;
const BRANCH = 'main';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const allowDirty = args.includes('--allow-dirty');
const dryRun = args.includes('--dry-run');   // every check and the trial export, but no publish

const say = msg => console.log(msg);
const step = name => console.log(`\n── ${name}`);
const die = msg => { console.error(`\nRELEASE STOPPED: ${msg}`); process.exit(1); };
const run = (cmd, argv, env = {}) => spawnSync(cmd, argv, { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 28 });

// ── key ──
step('Gemini key');
let key = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
if (!key && existsSync('.env.local')) key = readFileSync('.env.local', 'utf8').match(/^EXPO_PUBLIC_GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) die('no EXPO_PUBLIC_GEMINI_API_KEY in the environment or .env.local. A build without it makes every Gemini feature fail.');
say('found (not printed)');

// ── git ──
step('Committed code');
const sha = run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim();
const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']).stdout.trim();
if (dirty && !allowDirty) die(`uncommitted changes to tracked files, so the update would not match a commit:\n${dirty}\nCommit first (or pass --allow-dirty).`);
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
const buildId = `${sha}-${stamp}`;
say(`commit ${sha}${dirty ? ' (dirty, allowed)' : ''}  build id ${buildId}`);

// ── typecheck, lint, logic ──
step('Typecheck');
const tsc = run('npx', ['tsc', '--noEmit']);
const tscErrors = (tsc.stdout.match(/error TS/g) ?? []).length;
if (tscErrors > TSC_BASELINE) die(`${tscErrors} type errors (baseline ${TSC_BASELINE}):\n${tsc.stdout.split('\n').slice(0, 12).join('\n')}`);
say(`${tscErrors} errors, baseline ${TSC_BASELINE}: ok`);

step('Lint');
const lint = run('npx', ['eslint', 'app', 'components', 'lib', 'constants']);
const lintErrors = (lint.stdout.match(/^\s+\d+:\d+\s+error/gm) ?? []).length;
if (lintErrors) die(`${lintErrors} lint errors:\n${lint.stdout.split('\n').filter(l => /error/.test(l)).slice(0, 10).join('\n')}`);
say('0 errors: ok');

step('Logic checks');
const checks = run('node', ['scripts/check-lib.mjs']);
if (checks.status !== 0) die(`logic checks failed:\n${(checks.stdout + checks.stderr).split('\n').slice(-18).join('\n')}`);
say(checks.stdout.trim().split('\n').pop());

// ── trial export: does the build carry what it must? ──
step('Trial export (key and build id must be inside)');
const trial = mkdtempSync(join(tmpdir(), 'gym-release-'));
const env = { EXPO_PUBLIC_GEMINI_API_KEY: key, EXPO_PUBLIC_BUILD_ID: buildId };
// .env loading is switched off on purpose: this is how EAS runs, so only the passed-in variables count.
const exp = run('npx', ['expo', 'export', '--platform', 'ios', '--no-bytecode', '--output-dir', trial], { ...env, EXPO_NO_DOTENV: '1', CI: '1' });
if (exp.status !== 0) die(`trial export failed:\n${(exp.stdout + exp.stderr).split('\n').slice(-12).join('\n')}`);
const jsDir = join(trial, '_expo/static/js/ios');
const js = readFileSync(join(jsDir, readdirSync(jsDir).find(f => f.endsWith('.js'))), 'utf8');
const mustHave = [['Gemini key', key], ['Gemini API address', 'generativelanguage.googleapis.com'], ['build id', buildId]];
for (const [what, needle] of mustHave) if (!js.includes(needle)) die(`the trial export does not contain the ${what}. Nothing was published.`);
say('key, API address and build id all present: ok');

if (dryRun) { say('\nDRY RUN: all checks and the trial export passed. Nothing was published.'); process.exit(0); }

// ── publish ──
step('Publish to EAS');
const message = opt('--message', `build ${buildId}`);
const pub = run('npx', ['eas-cli', 'update', '--branch', BRANCH, '--platform', 'ios', '--environment', 'production', '--message', message, '--non-interactive'], env);
const out = pub.stdout + pub.stderr;
const group = out.match(/Update group ID\s+([0-9a-f-]{36})/)?.[1];
const updateId = out.match(/iOS update ID\s+([0-9a-f-]{36})/)?.[1];
if (pub.status !== 0 || !group || !updateId) die(`eas update failed:\n${out.split('\n').slice(-14).join('\n')}`);
say(`group ${group}\nupdate ${updateId}`);

// ── confirm Expo serves it ──
step('Confirm Expo serves it');
const projectId = JSON.parse(readFileSync('app.json', 'utf8')).expo.extra.eas.projectId;
const res = await fetch(`https://u.expo.dev/${projectId}/group/${group}`, {
  headers: { 'expo-protocol-version': '1', 'expo-platform': 'ios', 'expo-runtime-version': '1.0.0', Accept: 'multipart/mixed' },
});
const body = await res.text();
if (!body.includes(updateId)) die(`Expo answered ${res.status} but not with update ${updateId}.`);
say(`served: ${updateId}`);

step('Published bundle contains the key');
const hbcDir = join('dist/_expo/static/js/ios');
const hbc = join(hbcDir, readdirSync(hbcDir).filter(f => f.endsWith('.hbc')).sort().pop());
const strings = execFileSync('strings', ['-a', hbc], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (!strings.includes(key)) die('the published bundle does not contain the Gemini key. Do not use this update.');
say('key present in the bytecode: ok');

// ── hand over ──
const url = `exp://u.expo.dev/${projectId}/group/${group}`;
const qr = join(tmpdir(), `gym-update-${group.slice(0, 8)}.png`);
execFileSync('npx', ['--yes', 'qrcode', '-o', qr, '-w', '700', url], { stdio: 'ignore' });
if (process.platform === 'darwin') execFileSync('open', [qr]);
console.log(`\nDONE. Scan the QR with the iPhone Camera, then tap Open in Expo Go.\n${url}\n`);
console.log(`Check on the phone: long-press "Week" on the home screen, Build should read ${buildId}.`);
