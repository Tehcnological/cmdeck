import { EnvironmentId, type ForkAlert } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { startForkAlertNotifications } from "./forkAlertNotifications";

const state = vi.hoisted(() => ({
  inApp: true,
  toast: vi.fn(),
  alerts: new Map<string, unknown>(),
  environmentIds: null as unknown,
}));

vi.mock("../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("@t3tools/client-runtime/state/runtime", async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  return {
    createEnvironmentRpcSubscriptionAtomFamily:
      () =>
      ({ environmentId }: { environmentId: string }) => {
        if (!state.alerts.has(environmentId)) {
          state.alerts.set(
            environmentId,
            Atom.make(AsyncResult.initial<ForkAlert>()).pipe(Atom.keepAlive),
          );
        }
        return state.alerts.get(environmentId);
      },
  };
});
vi.mock("../state/presentation", async () => {
  const { Atom } = await import("effect/reactivity");
  state.environmentIds = Atom.make<ReadonlyArray<EnvironmentId>>([]).pipe(Atom.keepAlive);
  return { environmentSummaries: { environmentIdsAtom: state.environmentIds } };
});
vi.mock("../hooks/useSettings", () => ({
  getClientSettings: () => ({ notificationMode: "off", inAppNotificationsEnabled: state.inApp }),
}));
vi.mock("../components/ui/toast", () => ({
  toastManager: { add: state.toast },
  stackedThreadToast: (toast: unknown) => toast,
}));
vi.mock("../threadNotifications", () => ({
  hasNotificationSound: () => false,
  hasDesktopNotifications: () => false,
  playNotificationSound: vi.fn(),
}));

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");

const setEnvironments = (ids: ReadonlyArray<EnvironmentId>) =>
  appAtomRegistry.set(state.environmentIds as Atom.Writable<ReadonlyArray<EnvironmentId>>, ids);

const emit = (environmentId: EnvironmentId, id: string) => {
  const atom = state.alerts.get(environmentId) as
    | Atom.Writable<AsyncResult.AsyncResult<ForkAlert>>
    | undefined;
  if (atom === undefined) return;
  appAtomRegistry.set(
    atom,
    AsyncResult.success({ id, occurredAt: 0, title: `Alert ${id}`, body: "body" }),
  );
};

beforeEach(() => {
  state.inApp = true;
  state.toast.mockClear();
  vi.stubGlobal("document", { visibilityState: "visible", hasFocus: () => true });
});
afterEach(() => {
  setEnvironments([]);
  vi.unstubAllGlobals();
});

it("toasts alerts from every connected environment and drops removed ones", () => {
  const stop = startForkAlertNotifications();
  setEnvironments([envA, envB]);
  emit(envB, "disk");
  emit(envA, "disk");
  expect(state.toast.mock.calls.map(([toast]) => toast.title)).toEqual([
    "Alert disk",
    "Alert disk",
  ]);

  setEnvironments([envA]);
  emit(envB, "later");
  emit(envA, "later");
  expect(state.toast).toHaveBeenCalledTimes(3);
  stop();
});

it("shows no toast while in-app notifications are off", () => {
  state.inApp = false;
  const stop = startForkAlertNotifications();
  setEnvironments([envA]);
  emit(envA, "quiet");
  expect(state.toast).not.toHaveBeenCalled();
  stop();
});
