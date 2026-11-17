import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import { MACHINES_PATH } from '@/lib/storage';

/** What was learned about a machine at a gym, kept as text only: the photos are never stored. */
export type MachineProfile = {
  name: string;
  brand: string;
  gym: string;
  muscles: string;
  loading: string;
  maxStackKg: number | null;
  firstSetKg: number | null;
  addedAt: number;
};

type State = { machines: MachineProfile[]; consented: boolean };
export const useMachines = create<State>(() => ({ machines: [], consented: false }));

const keyOf = (name: string, gym: string) => `${name.trim().toLowerCase()}@${gym}`;
export const findMachine = (machines: MachineProfile[], name: string, gym: string) =>
  machines.find(m => keyOf(m.name, m.gym) === keyOf(name, gym));

async function save() {
  const { machines, consented } = useMachines.getState();
  await FileSystem.writeAsStringAsync(MACHINES_PATH, JSON.stringify({ machines, consented })).catch(() => {});
}

export async function loadMachines(): Promise<void> {
  try {
    if (!(await FileSystem.getInfoAsync(MACHINES_PATH)).exists) return;
    const saved = JSON.parse(await FileSystem.readAsStringAsync(MACHINES_PATH));
    useMachines.setState({ machines: Array.isArray(saved?.machines) ? saved.machines : [], consented: !!saved?.consented });
  } catch { /* unreadable: start empty */ }
}

export function rememberMachine(p: MachineProfile): void {
  const rest = useMachines.getState().machines.filter(m => keyOf(m.name, m.gym) !== keyOf(p.name, p.gym));
  useMachines.setState({ machines: [p, ...rest].slice(0, 200) });
  save();
}

export function giveConsent(): void {
  useMachines.setState({ consented: true });
  save();
}
