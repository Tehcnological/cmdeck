import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as BrowserSession from "../../preview/BrowserSession.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getLinuxSpellcheck = makeIpcMethod({
  channel: IpcChannels.GET_LINUX_SPELLCHECK_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.spellcheck.get")(function* () {
    return (yield* (yield* DesktopAppSettings.DesktopAppSettings).get).linuxSpellcheck;
  }),
});

export const setLinuxSpellcheck = makeIpcMethod({
  channel: IpcChannels.SET_LINUX_SPELLCHECK_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.spellcheck.set")(function* (enabled) {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    const saved = (yield* appSettings.setLinuxSpellcheck(enabled)).settings.linuxSpellcheck;
    yield* (yield* BrowserSession.BrowserSession).setLinuxSpellcheck(saved);
    return saved;
  }),
});
