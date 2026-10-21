import type { HistoryEntry } from '../types';

export const SEED_HISTORY: HistoryEntry[] = [
  {
    id: 'seed-2',
    date: 'Tue, 14 Apr 2026',
    workoutName: 'Push Day',
    duration: 6600,
    restTime: 0,
    exercises: [
      { id: '1', name: 'Flat DB Bench Press', muscles: 'Mid Chest, Triceps', type: 'Compound', target: '40–42.5 kg × 6–8 × 3', cue: 'Scap retracted • full ROM • controlled eccentric', sets: [{ weight: '40', reps: '6', drops: [] }, { weight: '40', reps: '6', drops: [] }, { weight: '40', reps: '4', drops: [] }] },
      { id: '2', name: 'Seated Hammer Curl (DB)', muscles: 'Brachialis, Biceps', type: 'Iso', target: '20–22.5 kg × 4–6', cue: 'Neutral grip • no torso swing • peak contraction', sets: [{ weight: '20', reps: '5', drops: [{ weight: '17.5', reps: '4' }] }, { weight: '20', reps: '5', drops: [{ weight: '17.5', reps: '4' }] }] },
      { id: '3', name: 'Incline DB Bench Press', muscles: 'Upper Chest, Triceps', type: 'Compound', target: '40–42.5 kg × 4–6 × 3', cue: 'Deep stretch • eye-line press • strict tempo', sets: [{ weight: '37.5', reps: '6', drops: [] }, { weight: '37.5', reps: '6', drops: [] }, { weight: '37.5', reps: '6', drops: [] }] },
      { id: '4', name: 'Incline Supinated DB Curl', muscles: 'Biceps Long Head', type: 'Iso', target: '20–22.5 kg × 5', cue: 'Elbows pinned • full stretch • 3s eccentric', sets: [{ weight: '20', reps: '5', drops: [{ weight: '17.5', reps: '4' }] }, { weight: '20', reps: '5', drops: [{ weight: '17.5', reps: '4' }] }] },
      { id: '5', name: 'Decline Chest Press (Machine)', muscles: 'Lower Chest, Triceps', type: 'Compound', target: '55–57.5 kg × 6 × 3', cue: 'Downward press path • lower pec drive • no lockout bounce', sets: [{ weight: '45', reps: '6', drops: [] }, { weight: '45', reps: '6', drops: [] }, { weight: '45', reps: '6', drops: [] }] },
      { id: '6', name: 'Preacher Curl (Machine/DB)', muscles: 'Biceps Short Head', type: 'Iso', target: '50–55 kg × 6', cue: 'Fixed elbow • squeeze peak • slow negative', sets: [{ weight: '45', reps: '6', drops: [] }, { weight: '45', reps: '6', drops: [] }, { weight: '45', reps: '6', drops: [] }] },
      { id: '7', name: 'Pec Deck Fly', muscles: 'Chest', type: 'Iso', target: '80–85 kg × 10–12 + dropset × 2', cue: 'Full contraction • 1s hold • controlled stretch', sets: [{ weight: '79', reps: '7', drops: [] }, { weight: '79', reps: '7', drops: [] }] },
    ],
  },
  {
    id: 'seed-1',
    date: 'Mon, 13 Apr 2026',
    workoutName: 'Leg A',
    duration: 5400,
    restTime: 600,
    exercises: [
      { id: 'la1', name: 'Hack Squat / Pendulum', muscles: 'Quads, Glutes', type: 'Compound', target: '80 kg × 6–8 × 3', cue: '', sets: [{ weight: '80', reps: '8', drops: [] }, { weight: '80', reps: '8', drops: [] }, { weight: '80', reps: '8', drops: [] }] },
      { id: 'la2', name: 'Dumbbell Romanian Deadlift', muscles: 'Hamstrings, Glutes', type: 'Compound', target: '40 kg each × 8 × 3', cue: '', sets: [{ weight: '40', reps: '8', drops: [] }, { weight: '40', reps: '8', drops: [] }, { weight: '40', reps: '8', drops: [] }] },
      { id: 'la3', name: 'Cable Pull-Through', muscles: 'Glutes, Hamstrings', type: 'Compound', target: '50 kg × 10–12 × 2–3', cue: '', sets: [{ weight: '50', reps: '10', drops: [] }, { weight: '50', reps: '10', drops: [] }, { weight: '50', reps: '10', drops: [] }] },
      { id: 'la4', name: 'Hip Thrust (Machine/Barbell)', muscles: 'Glute Maximus', type: 'Compound', target: '80 kg × 8–10 × 3', cue: '', sets: [{ weight: '80', reps: '10', drops: [] }, { weight: '80', reps: '10', drops: [] }, { weight: '80', reps: '10', drops: [] }] },
      { id: 'la5', name: 'Seated Leg Curl', muscles: 'Hamstrings', type: 'Iso', target: '130–140 kg × 10–12', cue: '', sets: [{ weight: '50', reps: '10', drops: [] }, { weight: '50', reps: '10', drops: [] }, { weight: '50', reps: '10', drops: [] }] },
      { id: 'la6', name: 'Seated Calf Raise', muscles: 'Gastrocnemius', type: 'Iso', target: '15 kg × 10–12', cue: '', sets: [{ weight: '15', reps: '10', drops: [] }, { weight: '15', reps: '10', drops: [] }, { weight: '15', reps: '10', drops: [] }] },
      { id: 'la7', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '65–75 kg × 12–15', cue: '', sets: [{ weight: '73', reps: '10', drops: [] }, { weight: '73', reps: '10', drops: [] }, { weight: '73', reps: '10', drops: [] }] },
    ],
  },
];

export const RESTORED_SESSIONS: HistoryEntry[] = [
  {
    id: 'restored-leg-a-13apr26',
    date: 'Mon, 13 Apr 2026',
    workoutName: 'Leg A',
    duration: 5400,
    restTime: 600,
    exercises: [
      { id: 'la1', name: 'Hack Squat / Pendulum', muscles: 'Quads, Glutes', type: 'Compound', target: '80 kg × 6–8 × 3', cue: '', sets: [{ weight: '80', reps: '8', rpe: '', drops: [] }, { weight: '80', reps: '8', rpe: '', drops: [] }, { weight: '80', reps: '8', rpe: '', drops: [] }] },
      { id: 'la2', name: 'Dumbbell Romanian Deadlift', muscles: 'Hamstrings, Glutes', type: 'Compound', target: '40 kg each × 8 × 3', cue: '', sets: [{ weight: '40', reps: '8', rpe: '', drops: [] }, { weight: '40', reps: '8', rpe: '', drops: [] }, { weight: '40', reps: '8', rpe: '', drops: [] }] },
      { id: 'la3', name: 'Cable Pull-Through', muscles: 'Glutes, Hamstrings', type: 'Compound', target: '50 kg × 10–12 × 2–3', cue: '', sets: [{ weight: '50', reps: '10', rpe: '', drops: [] }, { weight: '50', reps: '10', rpe: '', drops: [] }, { weight: '50', reps: '10', rpe: '', drops: [] }] },
      { id: 'la4', name: 'Hip Thrust (Machine/Barbell)', muscles: 'Glute Maximus', type: 'Compound', target: '80 kg × 8–10 × 3', cue: '', sets: [{ weight: '80', reps: '10', rpe: '', drops: [] }, { weight: '80', reps: '10', rpe: '', drops: [] }, { weight: '80', reps: '10', rpe: '', drops: [] }] },
      { id: 'la5', name: 'Seated Leg Curl', muscles: 'Hamstrings', type: 'Iso', target: '130–140 kg × 10–12', cue: '', sets: [{ weight: '50', reps: '10', rpe: '', drops: [] }, { weight: '50', reps: '10', rpe: '', drops: [] }, { weight: '50', reps: '10', rpe: '', drops: [] }] },
      { id: 'la6', name: 'Seated Calf Raise', muscles: 'Gastrocnemius', type: 'Iso', target: '15 kg × 10–12', cue: '', sets: [{ weight: '15', reps: '10', rpe: '', drops: [] }, { weight: '15', reps: '10', rpe: '', drops: [] }, { weight: '15', reps: '10', rpe: '', drops: [] }] },
      { id: 'la7', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '65–75 kg × 12–15', cue: '', sets: [{ weight: '73', reps: '10', rpe: '', drops: [] }, { weight: '73', reps: '10', rpe: '', drops: [] }, { weight: '73', reps: '10', rpe: '', drops: [] }] },
    ],
  },
  {
    id: 'restored-leg-a-18may26',
    date: 'Mon, 18 May 2026',
    workoutName: 'Leg A',
    duration: 1661,
    restTime: 5066,
    exercises: [
      { id: 'la18-1', name: 'Hack Squat', muscles: 'Quads, Glutes', type: 'Compound', target: '105 kg × 10 × 3', cue: '', sets: [{ weight: '105', reps: '10', rpe: '8.5', drops: [] }, { weight: '105', reps: '10', rpe: '8', drops: [] }, { weight: '105', reps: '10', rpe: '8', drops: [] }] },
      { id: 'la18-2', name: 'Hip Thrust (Machine)', muscles: 'Glute Maximus', type: 'Compound', target: '110 kg × 10 × 3', cue: '', sets: [{ weight: '110', reps: '10', rpe: '8', drops: [] }, { weight: '110', reps: '10', rpe: '8', drops: [] }, { weight: '110', reps: '10', rpe: '', drops: [] }] },
      { id: 'la18-3', name: 'Seated Leg Curl', muscles: 'Hamstrings', type: 'Iso', target: '79 kg × 10 × 3', cue: '', sets: [{ weight: '79', reps: '10', rpe: '8.5', drops: [] }, { weight: '79', reps: '10', rpe: '8.5', drops: [] }, { weight: '79', reps: '10', rpe: '8.5', drops: [] }] },
      { id: 'la18-4', name: 'Cable Pull-Through', muscles: 'Glutes, Hamstrings', type: 'Compound', target: '66 kg × 10 × 3', cue: '', sets: [{ weight: '66', reps: '10', rpe: '8', drops: [] }, { weight: '66', reps: '12', rpe: '8', drops: [] }, { weight: '66', reps: '12', rpe: '8', drops: [] }] },
      { id: 'la18-5', name: 'Cable Crunch', muscles: 'Abs', type: 'Iso', target: '82 kg × 12 × 3', cue: '', sets: [{ weight: '82', reps: '12', rpe: '8', drops: [] }, { weight: '82', reps: '12', rpe: '8', drops: [] }, { weight: '82', reps: '12', rpe: '8', drops: [] }] },
      { id: 'la18-6', name: 'Preacher Curl (Machine)', muscles: 'Biceps Short Head', type: 'Iso', target: '43 kg × 8 × 3 + dropset', cue: '', sets: [{ weight: '43', reps: '8', rpe: '7.5', drops: [{ weight: '34', reps: '4' }] }, { weight: '43', reps: '8', rpe: '8', drops: [{ weight: '34', reps: '4' }] }, { weight: '43', reps: '8', rpe: '8.5', drops: [{ weight: '34', reps: '4' }] }] },
      { id: 'la18-7', name: 'Machine Triceps Extension', muscles: 'Triceps', type: 'Iso', target: '45 kg × 8 × 3 + dropset', cue: '', sets: [{ weight: '45', reps: '8', rpe: '8', drops: [{ weight: '36', reps: '5' }] }, { weight: '45', reps: '8', rpe: '8', drops: [{ weight: '36', reps: '5' }] }, { weight: '45', reps: '8', rpe: '8', drops: [{ weight: '36', reps: '5' }] }] },
      { id: 'la18-8', name: 'Seated Calf Raise', muscles: 'Gastrocnemius', type: 'Iso', target: '25 kg × 12 × 3 + dropset', cue: '', notes: 'squeeze top, 3s eccentric', sets: [{ weight: '25', reps: '12', rpe: '8', drops: [{ weight: '20', reps: '8' }] }, { weight: '25', reps: '12', rpe: '8', drops: [] }, { weight: '25', reps: '12', rpe: '8', drops: [] }] },
    ],
  },
  {
    id: 'restored-push-14apr26',
    date: 'Tue, 14 Apr 2026',
    workoutName: 'Push Day',
    duration: 6600,
    restTime: 0,
    exercises: [
      { id: 'p1', name: 'Flat DB Bench Press', muscles: 'Mid Chest, Triceps', type: 'Compound', target: '40–42.5 kg × 6–8 × 3', cue: 'Scap retracted • full ROM • controlled eccentric', sets: [{ weight: '40', reps: '6', rpe: '', drops: [] }, { weight: '40', reps: '6', rpe: '', drops: [] }, { weight: '40', reps: '4', rpe: '', drops: [] }] },
      { id: 'p2', name: 'Incline DB Bench Press', muscles: 'Upper Chest, Triceps', type: 'Compound', target: '40–42.5 kg × 4–6 × 3', cue: 'Deep stretch • eye-line press • strict tempo', sets: [{ weight: '37.5', reps: '6', rpe: '', drops: [] }, { weight: '37.5', reps: '6', rpe: '', drops: [] }, { weight: '37.5', reps: '6', rpe: '', drops: [] }] },
      { id: 'p3', name: 'Decline Chest Press (Machine)', muscles: 'Lower Chest, Triceps', type: 'Compound', target: '55–57.5 kg × 6 × 3', cue: 'Downward press path • lower pec drive • no lockout bounce', sets: [{ weight: '45', reps: '6', rpe: '', drops: [] }, { weight: '45', reps: '6', rpe: '', drops: [] }, { weight: '45', reps: '6', rpe: '', drops: [] }] },
      { id: 'p4', name: 'Pec Deck Fly', muscles: 'Chest', type: 'Iso', target: '80–85 kg × 10–12 + dropset × 2', cue: 'Full contraction • 1s hold • controlled stretch', sets: [{ weight: '79', reps: '7', rpe: '', drops: [] }, { weight: '79', reps: '7', rpe: '', drops: [] }] },
      { id: 'p5', name: 'Seated Hammer Curl (DB)', muscles: 'Brachialis, Biceps', type: 'Iso', target: '20–22.5 kg × 4–6', cue: 'Neutral grip • no torso swing • peak contraction', sets: [{ weight: '20', reps: '5', rpe: '', drops: [{ weight: '17.5', reps: '4' }] }, { weight: '20', reps: '5', rpe: '', drops: [{ weight: '17.5', reps: '4' }] }] },
      { id: 'p6', name: 'Preacher Curl (Machine/DB)', muscles: 'Biceps Short Head', type: 'Iso', target: '50–55 kg × 6', cue: 'Fixed elbow • squeeze peak • slow negative', sets: [{ weight: '45', reps: '6', rpe: '', drops: [] }, { weight: '45', reps: '6', rpe: '', drops: [] }, { weight: '45', reps: '6', rpe: '', drops: [] }] },
    ],
  },
  {
    id: 'restored-leg-b-22may26',
    date: 'Fri, 22 May 2026',
    workoutName: 'Leg B',
    duration: 1582,
    restTime: 3720,
    exercises: [
      { id: 'lb1', name: 'Leg Press', muscles: 'Quads, Glutes', type: 'Compound', target: '150 kg × 10 × 3', cue: '', sets: [{ weight: '150', reps: '10', rpe: '8', drops: [] }, { weight: '150', reps: '10', rpe: '8', drops: [] }, { weight: '150', reps: '10', rpe: '8', drops: [] }] },
      { id: 'lb2', name: 'Bulgarian Split Squat (Smith)', muscles: 'Quads, Glutes', type: 'Compound', target: '75.9 kg × 8 × 3', cue: '', sets: [{ weight: '75.9', reps: '8', rpe: '8', drops: [] }, { weight: '75.9', reps: '8', rpe: '8', drops: [] }, { weight: '75.9', reps: '8', rpe: '8', drops: [] }] },
      { id: 'lb3', name: 'Lying Leg Curl', muscles: 'Hamstrings', type: 'Iso', target: '75 kg × 10 × 3', cue: '', sets: [{ weight: '45', reps: '9', rpe: '8.5', drops: [] }, { weight: '45', reps: '7', rpe: '8.5', drops: [] }, { weight: '45', reps: '7', rpe: '8.5', drops: [] }] },
      { id: 'lb5', name: 'Leg Extension', muscles: 'Quads', type: 'Iso', target: '95 kg × 10 × 3', cue: '', sets: [{ weight: '95', reps: '10', rpe: '8', drops: [] }, { weight: '95', reps: '10', rpe: '8', drops: [] }, { weight: '95', reps: '10', rpe: '8', drops: [] }] },
      { id: 'lb6', name: 'Standing Calf Raise', muscles: 'Calves', type: 'Iso', target: '25 kg × 12 × 3', cue: '', notes: '3s eccentric', sets: [{ weight: '25', reps: '12', rpe: '8', drops: [{ weight: '20', reps: '8' }] }, { weight: '25', reps: '12', rpe: '8', drops: [{ weight: '20', reps: '8' }] }, { weight: '25', reps: '12', rpe: '8', drops: [{ weight: '20', reps: '8' }] }] },
      { id: 'lb22-cc', name: "Captain's Chair Leg Raises", muscles: 'Abs', type: 'Iso', target: '2 kg × 20 × 3', cue: '', sets: [{ weight: '2', reps: '20', rpe: '8', drops: [] }, { weight: '2', reps: '20', rpe: '8', drops: [] }, { weight: '2', reps: '20', rpe: '8', drops: [] }] },
    ],
  },
];

