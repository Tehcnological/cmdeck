import { describe, expect, it } from "vite-plus/test";

import { mountArg, normalizeRecipe, recipeProblem } from "./argv.ts";

const recipe = {
  runtime: "docker" as const,
  ociRuntime: null,
  image: "ghcr.io/acme/agent:1.2@sha256:abc",
  network: "none",
  cpus: "1.5",
  memory: "4g",
  mounts: [{ hostPath: "~/.cache/agent", readOnly: true }],
  env: ["GH_TOKEN"],
};

describe("recipe validation", () => {
  it("trims values, so a stray space cannot turn none into another network", () => {
    expect(normalizeRecipe({ ...recipe, network: " none ", image: " acme/agent " })).toMatchObject({
      network: "none",
      image: "acme/agent",
    });
  });

  it.each([
    ["an image that is a flag", { image: "--privileged" }, "image"],
    ["an image with a space", { image: "acme agent" }, "image"],
    ["a network that is a flag", { network: "-v" }, "network"],
    // The host's own network reaches CMDeck and every service on its loopback.
    ["the host network", { network: "host" }, "network"],
    ["another container's network", { network: "container:db" }, "network"],
    ["an OCI runtime that is a flag", { ociRuntime: "--privileged" }, "OCI runtime"],
    ["cpus with a line break", { cpus: "2\nx" }, "CPUs"],
    ["memory that is a flag", { memory: "--cap-add=ALL" }, "memory"],
    ["a relative mount", { mounts: [{ hostPath: "relative/dir", readOnly: false }] }, "mount"],
    ["a mount with a line break", { mounts: [{ hostPath: "/a\rb", readOnly: false }] }, "mount"],
    ["a mount with a NUL", { mounts: [{ hostPath: "/a\u0000b", readOnly: false }] }, "mount"],
  ] as const)("refuses %s", (_name, overrides, field) => {
    expect(recipeProblem(normalizeRecipe({ ...recipe, ...overrides }))).toContain(field);
  });

  it("accepts an ordinary recipe, an empty image and Windows paths", () => {
    expect(recipeProblem(normalizeRecipe(recipe))).toBeNull();
    expect(recipeProblem(normalizeRecipe({ ...recipe, image: "" }))).toBeNull();
    const windows = { ...recipe, mounts: [{ hostPath: "C:\\Users\\me\\.cache", readOnly: true }] };
    expect(recipeProblem(normalizeRecipe(windows))).toBeNull();
  });
});

describe("mount CSV", () => {
  it("quotes a field with a line break, which would otherwise end the record", () => {
    expect(mountArg({ hostPath: "/a\nb", containerPath: "/x", readOnly: false }, false)).toBe(
      'type=bind,"source=/a\nb",target=/x',
    );
  });
});
