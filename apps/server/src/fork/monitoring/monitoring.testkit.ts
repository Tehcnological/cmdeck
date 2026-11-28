import type { HeartbeatSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as PeerLinks from "../../peer/PeerLinks.ts";
import * as Sqlite from "../../persistence/Sqlite.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as Notifications from "../notifications/Notifications.ts";
import * as Heartbeat from "./Heartbeat.ts";

/**
 * The real heartbeat over an in-memory database. HTTP probes answer with `httpStatus` and are
 * counted in `requests`; alerts land in `alerts`; PeerLinks dies if anything asks it.
 */
export const layerHeartbeatTest = (options: {
  readonly heartbeat: Partial<HeartbeatSettings>;
  readonly httpStatus: Ref.Ref<number>;
  readonly requests: Ref.Ref<ReadonlyArray<string>>;
  readonly alerts: Ref.Ref<ReadonlyArray<Notifications.AlertInput>>;
}) =>
  Heartbeat.layer.pipe(
    Layer.provideMerge(
      Layer.mock(Notifications.Notifications)({
        alert: (input) => Ref.update(options.alerts, (all) => [...all, input]),
      }),
    ),
    Layer.provideMerge(Layer.mock(PeerLinks.PeerLinks)({})),
    Layer.provideMerge(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.update(options.requests, (all) => [...all, request.url]).pipe(
            Effect.andThen(Ref.get(options.httpStatus)),
            Effect.map((status) =>
              HttpClientResponse.fromWeb(request, new Response(null, { status })),
            ),
          ),
        ),
      ),
    ),
    Layer.provideMerge(ServerSettings.layerTest({ cmdeck: { heartbeat: options.heartbeat } })),
    Layer.provideMerge(Sqlite.layerMemory),
  );
