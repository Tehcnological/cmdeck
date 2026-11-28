import type { HeartbeatSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as EventStore from "../../orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as PeerLinks from "../../peer/PeerLinks.ts";
import * as Sqlite from "../../persistence/Sqlite.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as Notifications from "../notifications/Notifications.ts";
import * as Heartbeat from "./Heartbeat.ts";

/**
 * The real heartbeat over an in-memory database. HTTP probes answer with `httpStatus` and are
 * counted in `requests`; alerts land in `alerts`; PeerLinks dies if anything asks it. Turns are
 * written through the real `EventSinkV2`.
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
    Layer.provideMerge(
      EventSink.layer.pipe(
        Layer.provideMerge(Layer.merge(EventStore.layer, ProjectionStore.layer)),
      ),
    ),
    Layer.provideMerge(Sqlite.layerMemory),
  );
