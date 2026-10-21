import * as FileSystem from 'expo-file-system/legacy';

// Files in the app's document directory. Each holds one JSON value.
export const HISTORY_PATH      = FileSystem.documentDirectory + 'history.json';
export const BADGES_PATH       = FileSystem.documentDirectory + 'badges.json';
export const BW_PATH           = FileSystem.documentDirectory + 'bodyweight.json';
export const WEEK_PLAN_PATH    = FileSystem.documentDirectory + 'weekPlan.json';
export const PENDING_PATH       = FileSystem.documentDirectory + 'pendingSession.json';
export const ACTIVE_SESSION_PATH = FileSystem.documentDirectory + 'activeSession.json';
export const GYM_PATH           = FileSystem.documentDirectory + 'gym.json';
export const GYMS_PATH          = FileSystem.documentDirectory + 'gyms.json';
export const EPOCH_PATH         = FileSystem.documentDirectory + 'epoch.json';

