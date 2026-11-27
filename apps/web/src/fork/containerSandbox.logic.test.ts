import { ThreadId, type SandboxRecipe, type SandboxStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formFromRecipe,
  optionalOciRuntimes,
  parseEnvNames,
  parseMounts,
  recipeFromForm,
  threadContainerActions,
} from "./containerSandbox.logic";

const recipe: SandboxRecipe = {
  runtime: "docker",
  ociRuntime: "runsc",
  image: "acme/agent:1",
  network: "none",
  cpus: "2",
  memory: null,
  mounts: [
    { hostPath: "~/.claude", readOnly: false },
    { hostPath: "C:\\Users\\me\\.gitconfig", readOnly: true },
  ],
  env: ["GH_TOKEN"],
};

const status = (overrides: Partial<SandboxStatus> = {}): SandboxStatus => ({
  recipe,
  ready: true,
  runtimes: [
    {
      kind: "docker",
      available: true,
      reason: null,
      ociRuntimes: ["io.containerd.runc.v2", "runc", "runsc"],
      gitOverlayIsCopy: false,
    },
  ],
  projects: [],
  thread: { threadId: ThreadId.make("thread-1"), mode: null, sandboxed: false },
  ...overrides,
});

describe("recipe form", () => {
  it("round-trips a recipe, keeping a Windows drive path and its read-only suffix apart", () => {
    expect(recipeFromForm(formFromRecipe(recipe))).toEqual(recipe);
  });

  it("parses mounts and names loosely and defaults the network to none", () => {
    expect(parseMounts(" /a \n\n/b:ro\n:ro")).toEqual([
      { hostPath: "/a", readOnly: false },
      { hostPath: "/b", readOnly: true },
      { hostPath: ":ro", readOnly: false },
    ]);
    expect(parseEnvNames("A, B\nA C")).toEqual(["A", "B", "C"]);
    const form = { ...formFromRecipe(recipe), network: " ", runtime: "apple" as const };
    expect(recipeFromForm(form)).toMatchObject({ network: "none", ociRuntime: null });
  });

  it("offers only runtimes beyond Docker's default", () => {
    expect(optionalOciRuntimes(status())).toEqual(["runsc"]);
  });
});

describe("threadContainerActions", () => {
  it.each([
    ["no status", null, []],
    ["no image yet", status({ recipe: { ...recipe, image: "" } }), []],
    ["on the host by its project", status(), ["run-in-container"]],
    [
      "in a container by its project",
      status({ thread: { threadId: ThreadId.make("t"), mode: null, sandboxed: true } }),
      ["run-on-host"],
    ],
    [
      "opted out on its own",
      status({ thread: { threadId: ThreadId.make("t"), mode: "off", sandboxed: false } }),
      ["run-in-container", "follow-project"],
    ],
  ] as const)("%s", (_name, current, actions) => {
    expect(threadContainerActions(current)).toEqual(actions);
  });
});
