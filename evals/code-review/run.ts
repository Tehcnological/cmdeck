#!/usr/bin/env node
// An eval script, not server code: it writes the preset's rules to a temporary module.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { CODE_REVIEW_LIB } from "../../apps/server/src/fork/presets/code-review.ts";
import { proxyConfig } from "../shared/proxy.ts";
import { cases, type Case } from "./cases.ts";
import { grade, type Review } from "./grade.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string", multiple: true },
    case: { type: "string", multiple: true },
    samples: { type: "string", default: "3" },
    concurrency: { type: "string", default: "4" },
    reasoning: { type: "string", default: "medium" },
  },
});
if (!values.out) throw new Error("Use --out <directory> [--model <id>] [--case <id>].");
const outDirectory = values.out;
const models = values.model ?? ["gpt-6.1-terra", "gpt-6-luna"];
const selected = values.case ? cases.filter((entry) => values.case!.includes(entry.id)) : cases;
if (selected.length === 0) throw new Error(`No case named ${values.case?.join(", ")}.`);
const proxy = proxyConfig();

type Lib = {
  readonly riskOf: (files: ReadonlyArray<unknown>) => unknown;
  readonly reviewBrief: (pr: unknown, change: unknown, risk: unknown) => string;
};
// The exact rules the preset ships, as the workflow file has them.
const libFile = NodePath.join(
  NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-code-review-eval-")),
  "lib.mjs",
);
NodeFS.writeFileSync(libFile, `${CODE_REVIEW_LIB}\nexport { riskOf, reviewBrief };\n`);
const lib = (await import(NodeURL.pathToFileURL(libFile).href)) as Lib;

const HEAD = "2222222222222222222222222222222222222222";
const briefOf = (entry: Case) => {
  const files = entry.files.map((file) => ({
    path: file.path,
    added: file.patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .length,
    removed: 0,
    binary: false,
    guardRemovals: 0,
    importFanout: 0,
  }));
  return lib.reviewBrief(
    {
      number: 7,
      title: entry.title,
      body: entry.body,
      headSha: HEAD,
      baseBranch: "main",
      failing: [],
    },
    {
      from: entry.since ?? "0000000000000000000000000000000000000000",
      to: HEAD,
      since: entry.since ?? null,
      patch: entry.files.map((file) => file.patch).join(""),
      truncated: false,
    },
    lib.riskOf(files),
  );
};

// The preset's `returns`, as a JSON schema the model answers in.
const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "line", "severity", "title", "detail"],
        properties: {
          path: { type: "string" },
          line: { type: ["number", "null"] },
          severity: { type: "string", enum: ["must-fix", "should-fix", "nit"] },
          title: { type: "string" },
          detail: { type: "string" },
        },
      },
    },
  },
};

const decodeResponse = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      output: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
      usage: Schema.optional(Schema.Struct({ total_tokens: Schema.optional(Schema.Number) })),
    }),
  ),
);
const encodeRow = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeReview = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      summary: Schema.String,
      findings: Schema.Array(
        Schema.Struct({
          path: Schema.String,
          line: Schema.NullOr(Schema.Number),
          severity: Schema.Literals(["must-fix", "should-fix", "nit"]),
          title: Schema.String,
          detail: Schema.String,
        }),
      ),
    }),
  ),
);

const runSample = Effect.fn("evaluateCodeReview.sample")(function* (entry: Case, model: string) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.retryTransient({
      retryOn: "errors-and-responses",
      schedule: Schedule.exponential("2 seconds"),
      times: 4,
    }),
  );
  const response = yield* HttpClientRequest.post(`${proxy.url}/responses`).pipe(
    HttpClientRequest.setHeaders(proxy.headers),
    HttpClientRequest.bodyJson({
      model,
      input: [{ role: "user", content: briefOf(entry) }],
      text: { format: { type: "json_schema", name: "review", schema: reviewSchema, strict: true } },
      reasoning: { effort: values.reasoning },
      store: false,
    }),
    Effect.flatMap(client.execute),
  );
  const text = yield* response.text;
  if (response.status !== 200)
    return yield* Effect.die(new Error(`Model API ${response.status}: ${text}`));
  const decoded = decodeResponse(text);
  const reply = decoded.output
    .filter((item) => item.type === "message")
    .flatMap((item) => (item.content as Array<{ text?: string }>).map((part) => part.text ?? ""))
    .join("");
  const review: Review = decodeReview(reply);
  return { ...grade({ ...entry, review }), review, tokens: decoded.usage?.total_tokens ?? 0 };
});

const sampleSafely = (entry: Case, model: string, sample: number) =>
  runSample(entry, model).pipe(
    Effect.map((result) => ({ case: entry.id, model, sample, ...result })),
    Effect.catchCause((cause) =>
      Effect.succeed({ case: entry.id, model, sample, error: String(cause) }),
    ),
  );

const summary = await Effect.runPromise(
  Effect.gen(function* () {
    NodeFS.mkdirSync(outDirectory, { recursive: true });
    const jobs = models.flatMap((model) =>
      selected.flatMap((entry) =>
        Array.from({ length: Number(values.samples) }, (_, n) => ({ model, entry, n })),
      ),
    );
    const rows = yield* Effect.forEach(
      jobs,
      ({ model, entry, n }) => sampleSafely(entry, model, n),
      {
        concurrency: Number(values.concurrency),
      },
    );
    NodeFS.writeFileSync(
      NodePath.join(outDirectory, "results.ndjson"),
      rows.map((row) => encodeRow(row)).join("\n") + "\n",
    );
    const lines = ["| model | case | passed | errors |", "|---|---|---|---|"];
    for (const model of models) {
      for (const entry of selected) {
        const own = rows.filter((row) => row.model === model && row.case === entry.id);
        const passes = own.filter((row) => "pass" in row && row.pass).length;
        const errors = own.filter((row) => "error" in row).length;
        // A case fails when half or more of its samples fail; an error is a failed sample.
        lines.push(
          `| ${model} | ${entry.id} | ${passes}/${own.length}${passes > own.length / 2 ? "" : " FAIL"} | ${errors} |`,
        );
      }
    }
    const report = lines.join("\n") + "\n";
    NodeFS.writeFileSync(NodePath.join(outDirectory, "summary.md"), report);
    return report;
  }).pipe(Effect.provide(FetchHttpClient.layer)),
);
process.stdout.write(summary);
