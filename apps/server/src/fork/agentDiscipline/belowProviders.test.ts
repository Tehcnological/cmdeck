import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as Sqlite from "../../persistence/Sqlite.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as ForkLayer from "../ForkLayer.ts";
import * as AgentDiscipline from "./AgentDiscipline.ts";

class SeenByAdapters extends Context.Service<
  SeenByAdapters,
  AgentDiscipline.AgentDiscipline["Service"]
>()("test/SeenByAdapters") {}
class SeenByOrchestration extends Context.Service<
  SeenByOrchestration,
  AgentDiscipline.AgentDiscipline["Service"]
>()("test/SeenByOrchestration") {}

const settings = ServerSettings.layerTest({});
const discipline = Effect.gen(function* () {
  return yield* AgentDiscipline.AgentDiscipline;
});

// Provider hydration builds the Claude adapters below orchestration. Their subagent hooks and
// delegate_task must count against one budget, so both levels must get the same instance.
it.effect("the provider-level and orchestration-level agent discipline are one instance", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      Layer.merge(
        Layer.effect(SeenByAdapters, discipline).pipe(
          Layer.provide(ForkLayer.belowProviders(settings, Sqlite.layerMemory)),
        ),
        Layer.effect(SeenByOrchestration, discipline).pipe(
          Layer.provide(AgentDiscipline.layer),
          Layer.provide(ProjectionStore.layer),
          Layer.provide(Layer.merge(settings, Sqlite.layerMemory)),
        ),
      ),
    );
    expect(Context.get(context, SeenByAdapters)).toBe(Context.get(context, SeenByOrchestration));
  }).pipe(Effect.scoped),
);
