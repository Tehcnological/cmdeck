import {
  ProviderInstanceId,
  type ServerProvider,
  type ServerSettings as ServerSettingsSchema,
  TextGenerationError,
} from "@t3tools/contracts";
import * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";
import type { DeepPartial } from "@t3tools/shared/Struct";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as TextGenerators from "../../textGeneration/TextGenerators.ts";
import * as Decisions from "./Decisions.ts";

export const LOCAL_GENERATOR = ProviderInstanceId.make("local-gen");
export const REMOTE_GENERATOR = ProviderInstanceId.make("remote-gen");

export const generators = {
  [LOCAL_GENERATOR]: {
    kind: "openaiCompatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "",
    enabled: true,
  },
  [REMOTE_GENERATOR]: {
    kind: "openaiCompatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "",
    enabled: true,
  },
} as const;

/** A model that records every prompt and replies with whatever `reply` holds at call time. */
export const makeFakeModel = () => {
  const prompts: Array<string> = [];
  const state: { reply: Effect.Effect<string, TextGenerationError> } = {
    reply: Effect.succeed('{"answers": {}}'),
  };
  const runner: TextGenerationOperations.Runner = (request) => {
    prompts.push(request.prompt);
    return Effect.suspend(() => state.reply).pipe(
      Effect.flatMap((text) => TextGenerationOperations.decodeJsonReply(request, "fake", text)),
    );
  };
  return {
    prompts,
    replyWith: (answers: Record<string, { value: unknown; confidence?: number }>) => {
      state.reply = Effect.succeed(JSON.stringify({ answers }));
    },
    failWith: (detail: string) => {
      state.reply = Effect.fail(new TextGenerationError({ operation: "decide", detail }));
    },
    hang: () => {
      state.reply = Effect.never;
    },
    layer: Layer.mock(TextGenerators.TextGenerators)({
      runner: (id) =>
        Effect.succeed(id === LOCAL_GENERATOR || id === REMOTE_GENERATOR ? runner : undefined),
    }),
  };
};

/** Decisions over a fresh database, a fake model and the given settings. */
export const layerDecisionsTest = (options: {
  readonly model: ReturnType<typeof makeFakeModel>;
  readonly settings?: DeepPartial<ServerSettingsSchema>;
  readonly providers?: ReadonlyArray<ServerProvider>;
}) =>
  Decisions.layer.pipe(
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provide(options.model.layer),
    Layer.provide(ServerSettings.layerTest({ textGenerators: generators, ...options.settings })),
    Layer.provide(
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.succeed(options.providers ?? []),
      }),
    ),
  );
