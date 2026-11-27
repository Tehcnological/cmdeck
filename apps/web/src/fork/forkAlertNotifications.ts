import { createEnvironmentRpcSubscriptionAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS, type EnvironmentId, type ForkAlert } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { connectionAtomRuntime } from "../connection/runtime";
import { getClientSettings } from "../hooks/useSettings";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentSummaries } from "../state/presentation";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
} from "../threadNotifications";

const forkAlerts = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:alerts",
  tag: CMDECK_WS_METHODS.notificationsSubscribeAlerts,
});

/**
 * Fork-only: every connected server's alerts (WI-1.04), told like thread alerts: a toast while the
 * app has focus, otherwise a system notification under the notification setting. The text is
 * server-authored English and already redacted.
 */
export function startForkAlertNotifications(): () => void {
  const shown = new Set<string>();
  const show = (environmentId: EnvironmentId, alert: ForkAlert) => {
    const key = `${environmentId}:${alert.id}`;
    if (shown.has(key)) return;
    shown.add(key);
    const { notificationMode: mode, inAppNotificationsEnabled } = getClientSettings();
    if (hasNotificationSound(mode)) {
      void playNotificationSound("input", () =>
        hasNotificationSound(getClientSettings().notificationMode),
      );
    }
    if (document.visibilityState === "visible" && document.hasFocus()) {
      if (inAppNotificationsEnabled) {
        toastManager.add(
          stackedThreadToast({ type: "warning", title: alert.title, description: alert.body }),
        );
      }
      return;
    }
    if (
      !hasDesktopNotifications(mode) ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return;
    try {
      const notification = new Notification(alert.title, {
        body: alert.body,
        tag: `cmdeck-alert:${key}`,
        silent: true,
      });
      notification.addEventListener("click", () => {
        notification.close();
        window.focus();
        void window.desktopBridge?.revealWindow().catch(() => undefined);
      });
    } catch {
      // Some browsers expose Notification but reject desktop presentation.
    }
  };
  const watched = new Map<EnvironmentId, () => void>();
  const follow = (environmentIds: ReadonlyArray<EnvironmentId>) => {
    const active = new Set(environmentIds);
    for (const [environmentId, unsubscribe] of watched) {
      if (active.has(environmentId)) continue;
      unsubscribe();
      watched.delete(environmentId);
    }
    for (const environmentId of active) {
      if (watched.has(environmentId)) continue;
      watched.set(
        environmentId,
        appAtomRegistry.subscribe(
          forkAlerts({ environmentId, input: {} }),
          (result) => {
            const alert = AsyncResult.getOrElse(result, () => null);
            if (alert !== null) show(environmentId, alert);
          },
          { immediate: true },
        ),
      );
    }
  };
  const unsubscribeEnvironments = appAtomRegistry.subscribe(
    environmentSummaries.environmentIdsAtom,
    follow,
    { immediate: true },
  );
  return () => {
    unsubscribeEnvironments();
    follow([]);
  };
}
