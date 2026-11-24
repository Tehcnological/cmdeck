import { DesktopTraySettingsSchema, DesktopTraySettingsUpdateSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopTray from "../../window/DesktopTray.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getTraySettings = makeIpcMethod({
  channel: IpcChannels.GET_TRAY_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: DesktopTraySettingsSchema,
  handler: Effect.fn("desktop.ipc.tray.getSettings")(function* () {
    return yield* (yield* DesktopTray.DesktopTray).settings;
  }),
});

export const setTraySettings = makeIpcMethod({
  channel: IpcChannels.SET_TRAY_SETTINGS_CHANNEL,
  payload: DesktopTraySettingsUpdateSchema,
  result: DesktopTraySettingsSchema,
  handler: Effect.fn("desktop.ipc.tray.setSettings")(function* (update) {
    return yield* (yield* DesktopTray.DesktopTray).update(update);
  }),
});
