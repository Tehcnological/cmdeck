import { describe, expect, it } from "vite-plus/test";

import { mergeCatalog } from "./merge-json-catalog.ts";

const catalog = (...entries: ReadonlyArray<string>) => `{\n${entries.join(",\n")}\n}\n`;
const nested = `  "n": [\n    {\n      "i": 1,\n      "c": ["a", "b"]\n    }\n  ]`;

describe("mergeCatalog", () => {
  it("keeps the strings each side added, ours first", () => {
    const base = catalog(`  "a": "A"`, nested);
    expect(
      mergeCatalog(
        base,
        catalog(`  "a": "A"`, nested, `  "o": "O"`),
        catalog(`  "a": "A"`, nested, `  "t": "T"`),
      ),
    ).toBe(catalog(`  "a": "A"`, nested, `  "o": "O"`, `  "t": "T"`));
  });

  it("takes one side's change or removal of a key the other left alone", () => {
    const base = catalog(`  "a": "A"`, `  "b": "B"`);
    expect(mergeCatalog(base, catalog(`  "a": "A2"`, `  "b": "B"`), catalog(`  "a": "A"`))).toBe(
      catalog(`  "a": "A2"`),
    );
  });

  it("merges two new files and identical changes", () => {
    expect(mergeCatalog("", catalog(`  "a": "A"`), catalog(`  "a": "A"`, `  "b": "B"`))).toBe(
      catalog(`  "a": "A"`, `  "b": "B"`),
    );
  });

  it("leaves a key both sides changed differently to a person", () => {
    const base = catalog(`  "a": "A"`);
    expect(mergeCatalog(base, catalog(`  "a": "X"`), catalog(`  "a": "Y"`))).toBeUndefined();
    expect(mergeCatalog(base, catalog(`  "a": "X"`), catalog(`  "b": "B"`))).toBeUndefined();
  });

  it("refuses files outside the formatted layout", () => {
    const ours = catalog(`  "a": "A"`);
    expect(mergeCatalog(ours, ours, `{"a": "A", "b": "B"}\n`)).toBeUndefined();
    expect(mergeCatalog(ours, ours, catalog(`  "a": "A"`, `  "a": "B"`))).toBeUndefined();
    expect(mergeCatalog(ours, ours, `{\n  "a": "A",\n}\n`)).toBeUndefined();
  });
});
