// Runnable checks for the calculation code in lib/. No test framework: compiles the files with tsc
// into a temp folder, then asserts on the results.  Run with:  node scripts/check-lib.mjs
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const out = mkdtempSync(join(tmpdir(), 'gym-lib-'));
try {
  execFileSync('npx', ['tsc', 'lib/progress.ts', 'lib/session-stats.ts', 'lib/progression.ts', 'lib/deload.ts', 'lib/format.ts',
    'constants/programs.ts', 'types.ts', '--outDir', out, '--rootDir', '.', '--module', 'commonjs', '--target', 'es2020',
    '--skipLibCheck', '--strict', '--ignoreConfig'], { stdio: 'inherit' });
  const req = createRequire(join(out, 'x.js'));
  const { estimate1RM, countedSets, parseDateLocal, exerciseSeries, personalRecords } = req('./lib/progress.js');
  const { sessionVolume, estimateNetKcal } = req('./lib/session-stats.js');
  const { parseRepRange, nextTarget, deriveTargets } = req('./lib/progression.js');
  const { deloadHint } = req('./lib/deload.js');

  let passed = 0;
  const check = (name, fn) => { fn(); passed++; console.log('ok  ' + name); };
  const set = (weight, reps, extra = {}) => ({ weight: String(weight), reps: String(reps), drops: [], ...extra });
  const ex = (name, sets, type = 'Compound') => ({ id: name, name, muscles: 'Chest', type, target: '', cue: '', sets });

  check('estimate1RM', () => {
    assert.equal(estimate1RM(100, 1), 103.5);
    assert.equal(estimate1RM(100, 10), 133.5);
    assert.equal(estimate1RM(50, 20), 70);      // reps capped at 12
    assert.equal(estimate1RM(80, 0), 0);
  });

  check('sessionVolume counts drops and honours ticks', () => {
    const e = ex('a', [set(100, 5, { done: true, drops: [{ weight: '80', reps: '5' }] }), set(100, 5, { done: false }), set(50, 10)]);
    assert.equal(sessionVolume([e], false), 500 + 400 + 500);   // history rule: only explicit false is skipped
    assert.equal(sessionVolume([e], true), 500 + 400);          // live rule: only ticked sets count
    assert.equal(sessionVolume([ex('b', [set(42.5, 5)])]), 213); // rounded to whole kg
  });

  check('estimateNetKcal', () => {
    assert.equal(estimateNetKcal(80, 1800, 2400), 253);
    assert.equal(estimateNetKcal(0, 1800, 2400), 0);
  });

  check('countedSets', () => {
    assert.equal(countedSets(ex('a', [set(10, 5), set(10, 5, { done: false }), set('', '')])).length, 1);
  });

  check('parseDateLocal copes with Sept', () => {
    assert.equal(parseDateLocal('Mon, 29 Sept 2025'), new Date(2025, 8, 29).getTime());
    assert.equal(parseDateLocal('Tue, 14 Apr 2026'), new Date(2026, 3, 14).getTime());
    assert.ok(Number.isNaN(parseDateLocal('nonsense')));
  });

  check('parseRepRange', () => {
    assert.deepEqual(parseRepRange('40 kg × 6–8 × 3'), { lo: 6, hi: 8 });
    assert.deepEqual(parseRepRange('40 kg × 8 × 3'), { lo: 8, hi: 8 });
    assert.equal(parseRepRange('bodyweight'), null);
  });

  const planned = (target, type = 'Compound') => ({ id: 'p', name: 'Bench', muscles: 'Chest', type, target, cue: '' });
  check('nextTarget: adds weight after hitting the top of the range', () => {
    const last = ex('Bench', [set(40, 8, { rpe: '8' }), set(40, 8), set(40, 8)]);
    assert.equal(nextTarget(planned('40 kg × 6–8 × 3'), last), '42.5 kg × 6 × 3');
  });
  check('nextTarget: otherwise one more rep, same weight', () => {
    assert.equal(nextTarget(planned('40 kg × 6–8 × 3'), ex('Bench', [set(40, 8), set(40, 7), set(40, 8)])), '40 kg × 8 × 3');
    assert.equal(nextTarget(planned('40 kg × 6–8 × 3'), ex('Bench', [set(40, 6), set(40, 6), set(40, 6)])), '40 kg × 7 × 3');
  });
  check('nextTarget: no weight jump when it was a grind (RPE 9)', () => {
    assert.equal(nextTarget(planned('40 kg × 6–8 × 3'), ex('Bench', [set(40, 8, { rpe: '9' }), set(40, 8), set(40, 8)])), '40 kg × 8 × 3');
  });
  check('nextTarget: light isolation work steps 1 kg', () => {
    assert.equal(nextTarget(planned('15 kg × 10–12 × 3', 'Iso'), ex('Bench', [set(15, 12), set(15, 12), set(15, 12)], 'Iso')), '16 kg × 10 × 3');
  });
  check('nextTarget: unticked sets are ignored and the planned set count is kept', () => {
    const last = ex('Bench', [set(40, 8, { done: true }), set(40, 8, { done: true }), set(40, 8, { done: false })]);
    assert.equal(nextTarget(planned('40 kg × 6–8 × 3'), last), '42.5 kg × 6 × 3');
  });
  check('nextTarget: keeps a dropset suffix, falls back to the plan with no history', () => {
    const last = ex('Bench', [set(20, 8), set(20, 8), set(20, 8)]);
    assert.equal(nextTarget(planned('20 kg × 8 × 3 + dropset → 15 kg × 6'), last), '22.5 kg × 8 × 3 + dropset → 15 kg × 6');
    assert.equal(nextTarget(planned('40 kg × 6–8 × 3'), undefined), '40 kg × 6–8 × 3');
  });

  const day = (d) => `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getFullYear()}`;
  check('deriveTargets uses the latest non-rest session of the matching workout', () => {
    const history = [
      { id: '1', date: day(new Date(2026, 3, 1)), workoutName: 'Push Day', duration: 0, restTime: 0, exercises: [ex('Bench', [set(30, 8), set(30, 8), set(30, 8)])] },
      { id: '2', date: day(new Date(2026, 3, 8)), workoutName: 'Push Day', duration: 0, restTime: 0, exercises: [ex('Bench', [set(40, 8), set(40, 8), set(40, 8)])] },
      { id: '3', date: day(new Date(2026, 3, 9)), workoutName: 'Push Day', duration: 0, restTime: 0, isRestDay: true, exercises: [] },
    ];
    assert.equal(deriveTargets({ 2: [planned('40 kg × 6–8 × 3')] }, history)[2][0].target, '42.5 kg × 6 × 3');
  });

  check('exerciseSeries and personalRecords', () => {
    const history = [
      { id: '1', date: day(new Date(2026, 3, 1)), workoutName: 'Push Day', duration: 0, restTime: 0, exercises: [ex('Bench', [set(40, 8)])] },
      { id: '2', date: day(new Date(2026, 3, 8)), workoutName: 'Push Day', duration: 0, restTime: 0, exercises: [ex('Bench', [set(40, 10), set(50, 3, { done: false })])] },
    ];
    const series = exerciseSeries(history, 'Bench');
    assert.equal(series.length, 2);
    assert.ok(series[1].e1rm > series[0].e1rm);
    assert.equal(personalRecords(history)[0].weight, 40);       // the unticked 50 kg set is ignored
  });

  check('deloadHint', () => {
    const epoch = new Date(2026, 0, 5).getTime();
    const weekMs = 7 * 24 * 3600 * 1000;
    const build = (weeks, volume) => weeks.map((w, i) => ({
      id: String(i), date: day(new Date(epoch + (w - 1) * weekMs + 86400000)), workoutName: 'Push Day', duration: 0, restTime: 0,
      exercises: [ex('Bench', [set(volume(w), 10)])],
    }));
    const steady = build([2, 3, 4, 5, 6], () => 100);
    assert.match(deloadHint(steady, epoch, 7) ?? '', /lighter week/);
    const withEasyWeek = build([2, 3, 4, 5, 6], w => (w === 5 ? 40 : 100));
    assert.equal(deloadHint(withEasyWeek, epoch, 7), null);
    assert.equal(deloadHint(steady.slice(0, 2), epoch, 4), null);
  });

  console.log(`\n${passed} checks passed`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
