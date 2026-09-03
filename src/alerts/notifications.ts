import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';
import { AlertKind } from '../data/types';

export const CHANNEL_ID = 'thermal-alerts';

/** Patterns are [wait, vibrate, wait, vibrate, ...] in milliseconds. */
const PATTERNS: Record<AlertKind, number[]> = {
  started: [0, 400, 200, 400],
  ended: [0, 400, 200, 400],
  out_of_band: [0, 180, 120, 180, 120, 180],
  data_stopped: [0, 600],
  data_resumed: [0, 200],
};

/**
 * Expo Go on Android throws the moment expo-notifications is imported, since
 * SDK 53 removed remote push from it. Loading it lazily inside a try means the
 * app still runs there — vibration works, banners do not. In a development
 * build both work. Nothing else in the app needs to know which it got.
 */
let N: typeof import('expo-notifications') | null = null;
export let notificationsAvailable = false;

try {
  N = require('expo-notifications');
  notificationsAvailable = true;
} catch {
  N = null;
  notificationsAvailable = false;
}

export async function setupNotifications(): Promise<boolean> {
  if (!N) {
    console.warn(
      'Notification banners are unavailable in Expo Go on Android. ' +
        'Alerts will still vibrate. Use a development build for the full behaviour.',
    );
    return false;
  }

  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  // Android 8+ takes the vibration pattern from the CHANNEL, not the individual
  // notification, and silently drops anything posted without one.
  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Thermal alerts',
      importance: N.AndroidImportance.MAX,
      vibrationPattern: PATTERNS.started,
      lightColor: '#F5A63C',
      lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
    });
  }

  const existing = await N.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await N.requestPermissionsAsync()).status;
  }
  return status === 'granted';
}

export async function presentAlert(opts: {
  kind: AlertKind;
  title: string;
  body: string;
  vibrate: boolean;
  sound: boolean;
  banners: boolean;
}) {
  if (N && opts.banners) {
    await N.scheduleNotificationAsync({
      content: {
        title: opts.title,
        body: opts.body,
        sound: opts.sound,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: null, // deliver immediately
    });
  }

  // Vibration is independent of the notification, so it works in Expo Go too.
  if (!opts.vibrate) return;
  if (Platform.OS === 'android') {
    Vibration.vibrate(PATTERNS[opts.kind], false);
  } else {
    await Haptics.notificationAsync(
      opts.kind === 'out_of_band' || opts.kind === 'data_stopped'
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Success,
    );
  }
}
