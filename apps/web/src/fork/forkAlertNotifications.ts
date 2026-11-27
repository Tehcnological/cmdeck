import { createEnvironmentRpcSubscriptionAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS, type EnvironmentId, type ForkAlert } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { connectionAtomRuntime } from "../connection/runtime";
import { getClientSettings } from "../hooks/useSettings";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
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
 * Fork-only: the primary server's alerts (WI-1.04), told like thread alerts: a toast while the
 * app has focus, otherwise a system notification under the notification setting. The text is
 * server-authored English and already redacted.
 */
export function startForkAlertNotifications(): () => void {
  const shown = new Set<string>();
  const show = (alert: ForkAlert) => {
    if (shown.has(alert.id)) return;
    shown.add(alert.id);
    const mode = getClientSettings().notificationMode;
    if (hasNotificationSound(mode)) {
      void playNotificationSound("input", () =>
        hasNotificationSound(getClientSettings().notificationMode),
      );
    }
    if (document.visibilityState === "visible" && document.hasFocus()) {
      toastManager.add(
        stackedThreadToast({ type: "warning", title: alert.title, description: alert.body }),
      );
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
        tag: `cmdeck-alert:${alert.id}`,
        silent: true,
      });
      notification.addEventListener("click", () => {
        notification.close();
        window.focus();
      });
    } catch {
      // Some browsers expose Notification but reject desktop presentation.
    }
  };
  let unsubscribeAlerts = () => {};
  const follow = (environmentId: EnvironmentId | null) => {
    unsubscribeAlerts();
    unsubscribeAlerts =
      environmentId === null
        ? () => {}
        : appAtomRegistry.subscribe(forkAlerts({ environmentId, input: {} }), (result) => {
            const alert = AsyncResult.getOrElse(result, () => null);
            if (alert !== null) show(alert);
          });
  };
  const unsubscribePrimary = appAtomRegistry.subscribe(primaryEnvironmentIdAtom, follow, {
    immediate: true,
  });
  return () => {
    unsubscribePrimary();
    unsubscribeAlerts();
  };
}
