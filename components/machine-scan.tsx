import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Ink } from '@/constants/theme';
import { FAILURE_TEXT } from '@/lib/gemini';
import type { GeminiImage } from '@/lib/gemini';
import { targetFor } from '@/lib/machine-plan';
import { readMachine } from '@/lib/machine-scan';
import type { ScanOutcome } from '@/lib/machine-scan';
import { findMachine, giveConsent, rememberMachine, useMachines } from '@/lib/machines';
import type { Exercise, HistoryEntry } from '../types';

type Props = {
  visible: boolean;
  onClose: () => void;
  history: HistoryEntry[];
  gym?: string;
  /** Points to add to logged RPEs, from the lifter's calibration. */
  bias?: number;
  /** The exercise to add, and the weight to start on (null when there was nothing to suggest). */
  onAdd: (exercise: Omit<Exercise, 'sets'>, startKg: number | null) => void;
};

const LOADING_TEXT: Record<string, string> = {
  'plate-loaded': 'plate-loaded', 'pin-stack': 'pin stack', cable: 'cable', dumbbell: 'dumbbell', barbell: 'barbell', bodyweight: 'bodyweight', other: '',
};

/** Compress a photo to something Gemini can read quickly: about 1024 px wide JPEG. */
async function shrink(uri: string): Promise<GeminiImage> {
  const r = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1024 } }], { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  return { mime: 'image/jpeg', data: r.base64 ?? '' };
}

/** Take a photo of a machine (and optionally its name plate), or type its name, and get a first-set weight from related exercises. */
export function MachineScan({ visible, onClose, history, gym, bias, onAdd }: Props) {
  const consented = useMachines(s => s.consented);
  const machines = useMachines(s => s.machines);
  const [step, setStep] = useState<'start' | 'reading' | 'confirm' | 'failed'>('start');
  const [images, setImages] = useState<GeminiImage[]>([]);
  const [typed, setTyped] = useState('');
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [name, setName] = useState('');
  const [kg, setKg] = useState('');
  const [problem, setProblem] = useState('');

  function reset() { setStep('start'); setImages([]); setTyped(''); setOutcome(null); setName(''); setKg(''); setProblem(''); }
  function close() { reset(); onClose(); }

  /** Photos leave the phone, so ask once before the first one is sent. */
  function confirmPhotoConsent(): Promise<boolean> {
    if (consented) return Promise.resolve(true);
    return new Promise(resolve => {
      Alert.alert(
        'Send photos to Google?',
        "Machine photos are sent to Google's Gemini to be read. On the free tier Google may use them to improve its products. Keep people out of the frame. Only the text it reads is saved, never the photo.",
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Send photos', onPress: () => { giveConsent(); resolve(true); } },
        ],
      );
    });
  }

  async function addPhoto(source: 'camera' | 'library') {
    if (!(await confirmPhotoConsent())) return;
    try {
      const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setProblem(source === 'camera' ? 'Camera access is off. Turn it on in Settings, or choose a photo instead.' : 'Photo access is off.'); return; }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
      const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]) return;
      const img = await shrink(res.assets[0].uri);
      if (!img.data) { setProblem('That photo could not be read. Try another.'); return; }
      setImages(prev => [...prev, img].slice(0, 2));
      setProblem('');
    } catch {
      setProblem('Could not open the camera. You can still type the machine name.');
    }
  }

  async function read() {
    setStep('reading');
    setProblem('');
    const r = await readMachine({ images, typedName: typed, history, gym, bias });
    setOutcome(r);
    if (!r.ok) {
      setProblem(r.failure === 'unreadable' ? "Couldn't tell what machine that is." : `Couldn't read it: ${FAILURE_TEXT[r.failure]}.`);
      setStep('failed');
      return;
    }
    setName(r.scan.name);
    setKg(r.suggestion ? String(r.suggestion.kg) : '');
    setStep('confirm');
  }

  function add() {
    if (!outcome?.ok || !name.trim()) return;
    const { scan, suggestion } = outcome;
    const start = parseFloat(kg);
    const startKg = start > 0 ? start : null;
    rememberMachine({
      name: name.trim(), brand: scan.brand, gym: gym ?? '', muscles: scan.muscles, loading: scan.loading,
      maxStackKg: scan.maxStackKg, firstSetKg: startKg ?? suggestion?.kg ?? null, addedAt: Date.now(),
    });
    const cue = `Log ${scan.loggedAs === 'total' ? 'the total or stack setting' : scan.loggedAs}${scan.maxStackKg ? `. Max ${scan.maxStackKg} kg` : ''}${scan.brand ? `. ${scan.brand}` : ''}`;
    onAdd({ id: `scan_${Date.now()}`, name: name.trim(), muscles: scan.muscles, type: scan.type, target: startKg ? targetFor(startKg) : '', cue }, startKg);
    close();
  }

  const known = outcome?.ok ? findMachine(machines, name, gym ?? '') : undefined;
  const canRead = images.length > 0 || typed.trim().length > 1;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={s.wrap}>
        <View style={s.head}>
          <Text style={s.title}>SCAN A MACHINE</Text>
          <TouchableOpacity onPress={close} hitSlop={12}><Text style={s.close}>Close</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {(step === 'start' || step === 'failed') && (
            <>
              {step === 'failed' && <Text style={s.problem}>{problem}</Text>}
              <TouchableOpacity style={s.primary} onPress={() => addPhoto('camera')}>
                <Text style={s.primaryText}>{images.length === 0 ? 'Take a photo of the machine' : 'Add a photo of the name plate'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.secondary} onPress={() => addPhoto('library')}>
                <Text style={s.secondaryText}>Choose from photos</Text>
              </TouchableOpacity>
              {!!problem && step === 'start' && <Text style={s.problem}>{problem}</Text>}
              {images.length > 0 && <Text style={s.dim}>{images.length} photo{images.length > 1 ? 's' : ''} ready{images.length < 2 ? '. If the name is hard to read, add one of the name plate.' : '.'}</Text>}

              <Text style={s.label}>Or type the name (saves a photo)</Text>
              <TextInput
                style={s.input}
                value={typed}
                onChangeText={setTyped}
                placeholder="e.g. hammer strength chest press"
                placeholderTextColor={Ink.textFaint}
                autoCorrect={false}
              />
              <TouchableOpacity style={[s.primary, !canRead && { opacity: 0.4 }]} onPress={read} disabled={!canRead}>
                <Text style={s.primaryText}>Read it</Text>
              </TouchableOpacity>
              {images.length > 0 && <TouchableOpacity onPress={() => setImages([])}><Text style={s.link}>Remove photos</Text></TouchableOpacity>}
            </>
          )}

          {step === 'reading' && (
            <View style={s.center}>
              <ActivityIndicator color={Ink.text} size="large" />
              <Text style={s.dim}>Reading the machine… this can take up to 30 seconds.</Text>
            </View>
          )}

          {step === 'confirm' && outcome?.ok && (
            <>
              <Text style={s.label}>Name</Text>
              <TextInput style={s.input} value={name} onChangeText={setName} autoCorrect={false} />
              <Text style={s.dim}>
                {outcome.scan.muscles}{LOADING_TEXT[outcome.scan.loading] ? ` · ${LOADING_TEXT[outcome.scan.loading]}` : ''}{outcome.scan.maxStackKg ? ` · max ${outcome.scan.maxStackKg} kg` : ''}
              </Text>
              {!!outcome.scan.plateText && <Text style={s.dim}>Plate says: {outcome.scan.plateText}</Text>}
              {outcome.scan.confidence === 'low' && <Text style={s.problem}>Not sure about this one. Check the name above, or go back and add a photo of the plate.</Text>}
              {!!known && <Text style={s.dim}>You added this here before (first set {known.firstSetKg ?? '?'} kg).</Text>}

              <View style={s.card}>
                {outcome.suggestion ? (
                  <>
                    <Text style={s.label}>Start on</Text>
                    <View style={s.kgRow}>
                      <TextInput style={s.kgInput} value={kg} onChangeText={setKg} keyboardType="decimal-pad" selectTextOnFocus />
                      <Text style={s.kgUnit}>kg {outcome.scan.loggedAs === 'total' ? '' : outcome.scan.loggedAs}</Text>
                    </View>
                    <Text style={s.dim}>{outcome.suggestion.reps} reps. Reasonable range {outcome.suggestion.low} to {outcome.suggestion.high} kg.</Text>
                    <Text style={s.dim}>From your {outcome.suggestion.analog} ({outcome.suggestion.basedOn}), about {Math.round(outcome.suggestion.ratio * 100)}% of its strength.</Text>
                    <Text style={s.note}>This is a guess. Rate your first set and the next ones adjust toward RPE 8.</Text>
                  </>
                ) : (
                  <Text style={s.dim}>You have nothing similar logged{gym ? ' at this gym' : ''}, so there is no weight to suggest. Start light and rate your first set.</Text>
                )}
              </View>

              <TouchableOpacity style={[s.primary, !name.trim() && { opacity: 0.4 }]} onPress={add} disabled={!name.trim()}>
                <Text style={s.primaryText}>Add exercise</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.secondary} onPress={() => setStep('start')}>
                <Text style={s.secondaryText}>Back</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: Ink.bg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: Ink.line },
  title: { fontFamily: 'Unbounded_700Bold', fontSize: 14, color: Ink.text },
  close: { fontSize: 15, color: Ink.text, fontWeight: '600' },
  body: { padding: 20, paddingBottom: 60 },
  center: { alignItems: 'center', paddingTop: 80, gap: 16 },
  primary: { minHeight: 56, borderRadius: 28, backgroundColor: Ink.text, alignItems: 'center', justifyContent: 'center', marginTop: 12, paddingHorizontal: 20 },
  primaryText: { fontSize: 16, fontWeight: '800', color: Ink.bg, textAlign: 'center' },
  secondary: { minHeight: 52, borderRadius: 26, borderWidth: 1, borderColor: Ink.line, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryText: { fontSize: 15, fontWeight: '600', color: Ink.text },
  link: { textAlign: 'center', marginTop: 14, fontSize: 14, color: Ink.textDim },
  label: { fontSize: 12, color: Ink.textDim, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 22, marginBottom: 6 },
  input: { height: 52, backgroundColor: Ink.raised, borderWidth: 1, borderColor: Ink.line, borderRadius: 14, paddingHorizontal: 16, fontSize: 16, color: Ink.text },
  dim: { fontSize: 14, color: Ink.textDim, marginTop: 10, lineHeight: 20 },
  note: { fontSize: 13, color: Ink.textFaint, marginTop: 12, lineHeight: 18 },
  problem: { fontSize: 14, color: Ink.text, marginTop: 12, lineHeight: 20, fontWeight: '600' },
  card: { marginTop: 20, backgroundColor: Ink.raised, borderRadius: 16, padding: 16 },
  kgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  kgInput: { minWidth: 110, fontFamily: 'Unbounded_700Bold', fontSize: 40, color: Ink.text, fontVariant: ['tabular-nums'], paddingVertical: 0 },
  kgUnit: { fontSize: 16, color: Ink.textDim, paddingBottom: 8 },
});
