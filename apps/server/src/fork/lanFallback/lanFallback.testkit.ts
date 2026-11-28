import type { ManagedPolicyDocument, ServerSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ManagedPolicy from "../../policy/ManagedPolicy.ts";
import * as ServerSettingsService from "../../serverSettings.ts";
import { ServerSecretStore } from "../secrets/EncryptedSecretStore.ts";
import * as LanFallback from "./LanFallback.ts";

/** The real LAN fallback with its setting in `enabled`, its secrets in `secrets`, and no policy unless given. */
export const layerLanFallbackTest = (options: {
  readonly enabled: SubscriptionRef.SubscriptionRef<boolean>;
  readonly secrets: Map<string, Uint8Array>;
  readonly lan: LanFallback.LanFallbackOptions;
  readonly policy?: ManagedPolicyDocument;
}) => {
  const settingsWith = (lanFallback: boolean) =>
    ({ cmdeck: { lanFallback } }) as unknown as ServerSettings;
  return LanFallback.layerWith(options.lan).pipe(
    Layer.provide(
      Layer.mock(ServerSettingsService.ServerSettingsService)({
        getSettings: SubscriptionRef.get(options.enabled).pipe(Effect.map(settingsWith)),
        subscribeChanges: Effect.succeed(
          SubscriptionRef.changes(options.enabled).pipe(Stream.map(settingsWith)),
        ),
      }),
    ),
    Layer.provide(ManagedPolicy.layerTest(options.policy)),
    Layer.provide(
      Layer.mock(ServerSecretStore)({
        get: (name) => Effect.sync(() => Option.fromNullishOr(options.secrets.get(name))),
        set: (name, value) => Effect.sync(() => void options.secrets.set(name, value)),
      }),
    ),
  );
};
