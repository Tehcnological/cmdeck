import { InferenceServerId, type InferenceServerSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  embedderOptions,
  embedderValue,
  KEYWORDS_ONLY,
  settingForValue,
} from "./memoryEmbeddings.logic";

const server = (
  id: string,
  baseUrl: string,
  models: ReadonlyArray<string>,
  enabled = true,
): InferenceServerSnapshot => ({
  id: InferenceServerId.make(id),
  displayName: id,
  baseUrl,
  enabled,
  status: "ready",
  checkedAt: null,
  models: models.map((model) => ({ id: model })),
});

const ollama = server("ollama", "http://127.0.0.1:11434/v1", ["nomic-embed-text", "qwen3"]);
const box = server("box", "http://192.168.1.20:8080/v1", ["bge-small"]);
const hosted = server("hosted", "https://api.example.com/v1", ["text-embedding-3-small"]);
const off = server("off", "http://localhost:1234/v1", ["e5"], false);

describe("embedderOptions", () => {
  it("lists every model of enabled local servers only", () => {
    expect(
      embedderOptions([ollama, box, hosted, off], null).map(
        (option) => `${option.serverName}/${option.setting.model}`,
      ),
    ).toEqual(["ollama/nomic-embed-text", "ollama/qwen3", "box/bge-small"]);
  });

  it("keeps the chosen embedder listed after its server stops offering it", () => {
    const current = { serverId: InferenceServerId.make("gone"), model: "e5" };
    const options = embedderOptions([ollama], current);
    expect(options[0]?.value).toBe(embedderValue(current));
    expect(options).toHaveLength(3);
  });

  it("maps a picked value back to its setting, and keywords-only to null", () => {
    const options = embedderOptions([box], null);
    expect(settingForValue(options, options[0]!.value)).toEqual({
      serverId: "box",
      model: "bge-small",
    });
    expect(settingForValue(options, KEYWORDS_ONLY)).toBeNull();
    expect(embedderValue(null)).toBe(KEYWORDS_ONLY);
  });
});
