import { assert, describe, it } from "@effect/vitest";

import {
  LAUNCH_HIDDEN_ARGUMENT,
  renderAutostartDesktopEntry,
  shouldStartHidden,
  trayServerStatus,
} from "./DesktopTrayPolicy.ts";

const ready = { ready: true, desiredRunning: true };
const starting = { ready: false, desiredRunning: true };
const stopped = { ready: false, desiredRunning: false };

describe("trayServerStatus", () => {
  it("follows the bundled backend", () => {
    const status = (snapshot: typeof ready, failing = false, quitting = false) =>
      trayServerStatus({
        localEnvironmentEnabled: true,
        quitting,
        startup: failing
          ? { _tag: "Failing", reason: "exited", managedPolicy: false, output: "" }
          : { _tag: "Starting" },
        snapshot,
      });
    assert.equal(status(ready), "running");
    assert.equal(status(starting), "starting");
    assert.equal(status(starting, true), "failing");
    assert.equal(status(stopped), "stopped");
    assert.equal(status(ready, false, true), "stopping");
  });

  it("reports a server this app does not run when the local environment is off", () => {
    assert.equal(
      trayServerStatus({
        localEnvironmentEnabled: false,
        quitting: false,
        startup: { _tag: "Starting" },
        snapshot: stopped,
      }),
      "external",
    );
  });
});

describe("shouldStartHidden", () => {
  it("stays in the tray only for a login launch with a tray to come back to", () => {
    assert.isTrue(shouldStartHidden({ launchedAtLogin: true, trayActive: true }));
    assert.isFalse(shouldStartHidden({ launchedAtLogin: true, trayActive: false }));
    assert.isFalse(shouldStartHidden({ launchedAtLogin: false, trayActive: true }));
  });
});

describe("renderAutostartDesktopEntry", () => {
  it("quotes the launcher and passes the hidden-launch argument", () => {
    const entry = renderAutostartDesktopEntry({
      displayName: "T3 Code",
      execTarget: "/home/me/Apps/T3 Code.AppImage",
    });
    assert.include(entry, `Exec="/home/me/Apps/T3 Code.AppImage" ${LAUNCH_HIDDEN_ARGUMENT}\n`);
    assert.include(entry, "Name=T3 Code\n");
    assert.isTrue(entry.startsWith("[Desktop Entry]\nType=Application\n"));
  });
});
