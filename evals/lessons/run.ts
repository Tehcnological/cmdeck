#!/usr/bin/env node
import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { TextGeneratorKind } from "@t3tools/contracts";
import * as TextGenerationOperations from "@t3tools/provider-core/server/textGenerationOperations";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { FetchHttpClient } from "effect/http";

import { consolidationInput } from "../../apps/server/src/fork/lessons/input.ts";
import {
  buildConsolidationPrompt,
  LessonsReply,
  proposedLessons,
} from "../../apps/server/src/fork/lessons/prompt.ts";
import { TEXT_GENERATOR_DRIVERS } from "../../apps/server/src/textGeneration/textGeneratorDrivers.ts";
import { cases } from "./cases.ts";
import { gradeLessons } from "./grade.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string" },
    kind: { type: "string", default: "openaiCompatible" },
    "base-url": { type: "string", default: "http://127.0.0.1:11434/v1" },
    baseline: { type: "string" },
    case: { type: "string" },
    samples: { type: "string", default: "3" },
  },
});
const { out, model } = values;
const samples = Number(values.samples);
const kind = Schema.decodeUnknownSync(TextGeneratorKind)(values.kind);
const fixtures = cases.filter((fixture) => !values.case || fixture.id === values.case);
if (!out || !model || !fixtures.length || !Number.isSafeInteger(samples) || samples < 1) {
  throw new Error(
    `Use --out <directory> --model <id> [--kind openaiCompatible|anthropic] [--base-url <url>] [--case <id>] [--samples <count>]. Cases: ${cases.map((fixture) => fixture.id).join(", ")}`,
  );
}
const Results = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      sample: Schema.Number,
      lessons: Schema.Array(Schema.String),
      passed: Schema.Boolean,
    }),
  ),
);
const decodeResults = Schema.decodeEffect(Results);
const encodeRows = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const connection = {
  baseUrl: values["base-url"],
  apiKey: process.env.LESSONS_EVAL_API_KEY ?? "",
  label: "lessons eval",
};

await Effect.runPromise(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseline = values.baseline
      ? yield* fs.readFileString(values.baseline).pipe(Effect.tap(decodeResults))
      : undefined;
    const results = [];
    for (const fixture of fixtures) {
      const prompt = buildConsolidationPrompt(consolidationInput(fixture.messages, null).text);
      for (let sample = 1; sample <= samples; sample++) {
        const text = yield* TEXT_GENERATOR_DRIVERS[kind].generate(connection, model, prompt);
        const reply = yield* TextGenerationOperations.decodeJsonReply(
          {
            operation: "lessons" as TextGenerationOperations.Operation,
            outputSchema: LessonsReply,
          },
          connection.label,
          text,
        );
        const lessons = proposedLessons(reply);
        results.push({ id: fixture.id, sample, lessons, passed: gradeLessons(fixture, lessons) });
      }
    }
    yield* fs.makeDirectory(out, { recursive: true });
    yield* fs.writeFileString(path.join(out, "results.json"), yield* encodeRows(results));
    if (baseline !== undefined) {
      yield* fs.writeFileString(path.join(out, "baseline.json"), baseline);
    }
    yield* Effect.log(
      `${results.filter((row) => row.passed).length}/${results.length} passed; results in ${out}`,
    );
  }).pipe(Effect.provide([NodeServices.layer, FetchHttpClient.layer]), Effect.scoped),
);
