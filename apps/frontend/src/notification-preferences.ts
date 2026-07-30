const preferenceKey = (queueId: string) => `nextq:notifications:${queueId}`;

export const notificationPreferenceStore = {
  load(queueId: string) {
    try {
      return localStorage.getItem(preferenceKey(queueId)) === 'enabled';
    } catch {
      return false;
    }
  },
  enable(queueId: string) {
    try {
      localStorage.setItem(preferenceKey(queueId), 'enabled');
    } catch {
      // In-app alerts remain active for this page even when storage is unavailable.
    }
  },
};

function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  try {
    if (
      typeof Notification === 'undefined' ||
      typeof Notification.requestPermission !== 'function'
    ) {
      return Promise.resolve('unsupported');
    }
    return (
      Notification.permission === 'default'
        ? Notification.requestPermission()
        : Promise.resolve(Notification.permission)
    ).catch(() => 'unsupported');
  } catch {
    return Promise.resolve('unsupported');
  }
}

export async function enableForegroundNotifications(queueId: string) {
  const permission = await requestNotificationPermission();
  notificationPreferenceStore.enable(queueId);
  return permission;
}

export async function deliverForegroundNotification(title: string, body: string) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'nextq-called' });
    }
  } catch {
    // The persistent in-app banner remains the authoritative foreground alert.
  }
}
