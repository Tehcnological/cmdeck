import { EnvironmentId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import type { ServerPairingLinkRecord } from "~/environments/primary";
import { render } from "../../../test/render";
import { ConnectDeviceApprovalSettings } from "./ConnectDeviceApprovalSettings";

const environmentId = EnvironmentId.make("host");

const state = vi.hoisted(() => ({ calls: [] as Array<unknown> }));

vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => (input: unknown) => {
    state.calls.push(input);
    return Promise.resolve({ _tag: "Success", value: {} });
  }) as never,
}));

const waiting: ServerPairingLinkRecord = {
  id: "link-1",
  scopes: ["orchestration:read", "access:write"],
  subject: "one-time-token",
  createdAt: "2026-11-24T10:00:00.000Z",
  expiresAt: "2026-11-24T10:10:00.000Z",
  pairingRequest: {
    client: { label: "Pixel 9", os: "Android", deviceType: "mobile" },
    requestedAt: DateTime.makeUnsafe("2026-11-24T10:00:00.000Z"),
    expiresAt: DateTime.makeUnsafe("2026-11-24T10:10:00.000Z"),
  },
};

const renderApproval = (canWrite: boolean) =>
  render(
    <ConnectDeviceApprovalSettings
      environmentId={environmentId}
      requests={[]}
      pairingRequests={[waiting]}
      devices={[]}
      canWrite={canWrite}
      requestRevoke={() => {}}
    />,
  );

describe("ConnectDeviceApprovalSettings", () => {
  it("shows a device waiting on a pairing link and approves or denies it", async () => {
    state.calls = [];
    await using screen = await renderApproval(true);

    await expect.element(screen.getByText(/Pixel 9 · Android/)).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Requested scopes: show 2 scopes" }))
      .toBeVisible();

    await screen.getByRole("button", { name: "Approve" }).click();
    await screen.getByRole("button", { name: "Deny" }).click();
    expect(state.calls).toEqual([
      { environmentId, input: { pairingLinkId: "link-1" } },
      { environmentId, input: { id: "link-1" } },
    ]);
  });

  it("leaves the answers to sessions that can manage access", async () => {
    await using screen = await renderApproval(false);

    await expect.element(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect.element(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
  });
});
