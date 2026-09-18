import * as Notifications from 'expo-notifications';
import { AlertKind, Process } from '../data/types';
import * as db from '../db/database';

/**
 * Alerts can reach the phone twice: once pushed by the server, once detected by
 * the app itself while it is open. Both are wanted — the server covers the app
 * being closed, the app covers the server being unreachable — but the phone
 * should only buzz once.
 *
 * Whichever arrives first claims the event. The second one is recorded in
 * history if it is not already there, and stays silent.
 */

type Claimed = { process: Process; kind: AlertKind };

function parse(content: Notifications.NotificationContent): Claimed | null {
  const data = content.data as Record<string, unknown> | undefined;
  const process = data?.process;
  const kind = data?.kind;
  if (process !== 'withering' && process !== 'fermentation') return null;
  if (typeof kind !== 'string') return null;
  return { process, kind: kind as AlertKind };
}

/** Call once at startup. Returns an unsubscribe function. */
export function listenForPush(onRecorded: () => void) {
  const sub = Notifications.addNotificationReceivedListener(async (notification) => {
    const claimed = parse(notification.request.content);
    if (!claimed) return;

    // Claim it so the app's own detector stays quiet for this event.
    await db.claimDelivery(`${claimed.process}:${claimed.kind}`);

    const { title, body } = notification.request.content;
    if (title) {
      await db.saveAlert({
        id: `push-${claimed.process}-${claimed.kind}-${Date.now()}`,
        kind: claimed.kind,
        process: claimed.process,
        deviceId: claimed.process,
        title,
        body: body ?? '',
        at: Date.now(),
      });
      onRecorded();
    }
  });

  return () => sub.remove();
}
