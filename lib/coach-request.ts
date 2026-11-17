import { create } from 'zustand';

/** Another tab asks the Home tab to open its in-app coach, since the coach screen lives there. */
export type CoachRequest = { mode: 'week' };

export const useCoachRequest = create<{ request: CoachRequest | null }>(() => ({ request: null }));
export const requestCoach = (request: CoachRequest) => useCoachRequest.setState({ request });
export const clearCoachRequest = () => useCoachRequest.setState({ request: null });
