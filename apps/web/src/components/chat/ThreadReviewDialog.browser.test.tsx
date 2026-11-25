import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironmentProviders: (() => new Map([[environmentId, providers]])) as never,
}));
vi.mock(import("~/hooks/useSettings"), async (original) => ({
  ...(await original()),
  useEnvironmentSettings: (() => ({
    ...DEFAULT_UNIFIED_SETTINGS,
    providerInstances: {
      "claude-work": { driver: "claudeAgent", enabled: true },
      antigravity: { driver: "antigravity", enabled: true },
    },
  })) as never,
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useThreadShell: () => null,
}));
vi.mock(import("~/state/threads"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    threadEnvironment: {
      ...actual.threadEnvironment,
      startReview: { ...actual.threadEnvironment.startReview, permissionAtom: () => canStart },
    } as never,
  };
});

import { RegistryContext } from "@effect/atom-react";

import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { act, render } from "../../../test/render";
import { ThreadReviewDialogHost } from "./ThreadReviewDialog";
import { openThreadReviewDialog } from "./threadReviewDialogState";

const environmentId = EnvironmentId.make("environment-review");
const canStart = Atom.make(true);

const provider = (
  instanceId: string,
  driver: string,
  displayName: string,
  model: { readonly slug: string; readonly name: string },
): ServerProvider => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: ProviderDriverKind.make(driver),
  displayName,
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-11-24T00:00:00.000Z",
  models: [{ ...model, isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
});

const providers = [
  provider("claude-work", "claudeAgent", "Claude", { slug: "sonnet", name: "Claude Review" }),
  provider("antigravity", "antigravity", "Antigravity", { slug: "hawk-review", name: "Hawk" }),
];

// Dialog footers sit below the fold of the default phone-sized test viewport.
async function desktopViewport(): Promise<AsyncDisposable> {
  const { innerWidth: width, innerHeight: height } = window;
  await page.viewport(1280, 800);
  return { [Symbol.asyncDispose]: () => page.viewport(width, height) };
}

it("offers every provider, Antigravity included, with the last reviewer prefilled", async () => {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    reviewerModelSelections: {
      [environmentId]: { instanceId: ProviderInstanceId.make("antigravity"), model: "hawk-review" },
    },
  });
  await using _viewport = await desktopViewport();
  await using _screen = await render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <ThreadReviewDialogHost />
    </RegistryContext.Provider>,
  );
  await act(() =>
    openThreadReviewDialog({ environmentId, threadId: ThreadId.make("thread-review") }),
  );

  const trigger = page.getByRole("button", { name: "Reviewer model" });
  await expect.element(trigger).toHaveTextContent("Hawk");
  await expect.element(page.getByRole("button", { name: "Start review" })).toBeEnabled();

  await trigger.click();
  await expect
    .element(page.getByRole("button", { name: /^Antigravity/ }))
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: /^Claude/ })).toBeVisible();
});
