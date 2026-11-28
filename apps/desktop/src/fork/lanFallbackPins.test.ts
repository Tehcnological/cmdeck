// @effect-diagnostics nodeBuiltinImport:off -- real certificates from Node's bundled root store.
import {
  BearerConnectionProfile,
  BearerConnectionTarget,
} from "@t3tools/client-runtime/connection";
import {
  ConnectionCatalogDocument,
  EMPTY_CONNECTION_CATALOG_DOCUMENT,
} from "@t3tools/client-runtime/platform";
import { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as NodeCrypto from "node:crypto";
import * as NodeTls from "node:tls";
import { describe, expect, it } from "vite-plus/test";

import { pemSha256, pinsFromCatalog, verifyPinnedCertificate } from "./lanFallbackPins.ts";

const [PINNED_PEM, PUBLIC_CA_PEM] = NodeTls.rootCertificates;
const PIN = pemSha256(PINNED_PEM!);
const ENVIRONMENT_ID = EnvironmentId.make("environment-lan");

const profile = (connectionId: string, httpBaseUrl: string, certificateSha256?: string) =>
  new BearerConnectionProfile({
    connectionId,
    environmentId: ENVIRONMENT_ID,
    label: "Box",
    httpBaseUrl,
    wsBaseUrl: httpBaseUrl.replace(/^http/, "ws"),
    ...(certificateSha256 === undefined ? {} : { certificateSha256 }),
  });

const catalog = Schema.encodeSync(Schema.fromJsonString(ConnectionCatalogDocument))({
  ...EMPTY_CONNECTION_CATALOG_DOCUMENT,
  targets: [
    new BearerConnectionTarget({
      environmentId: ENVIRONMENT_ID,
      label: "Box",
      connectionId: "bearer:tailnet",
    }),
  ],
  profiles: [
    profile("bearer:tailnet", "https://box.example.ts.net/"),
    profile("learned:lan", "https://192.168.1.10:4000/", PIN),
    profile("learned:ula", "https://[fd12::10]:4000/", PIN),
    // A pin never makes plain HTTP trusted, so it is not one.
    profile("learned:http", "http://192.168.1.11:4000/", PIN),
  ],
});

describe("LAN fallback pins", () => {
  it("hashes a PEM certificate the way the server computes its pin", () => {
    const expected = new NodeCrypto.X509Certificate(PINNED_PEM!).fingerprint256
      .replaceAll(":", "")
      .toLowerCase();
    expect(PIN).toBe(expected);
  });

  it("reads pins for saved HTTPS routes from the catalog", () => {
    const pins = pinsFromCatalog(catalog);
    expect([...pins.keys()].toSorted()).toEqual(["192.168.1.10", "fd12::10"]);
    expect([...pins.get("192.168.1.10")!]).toEqual([PIN]);
    expect(pinsFromCatalog(null).size).toBe(0);
    expect(pinsFromCatalog("not json").size).toBe(0);
  });

  it("accepts only the exact pinned certificate on a pinned host", () => {
    const pins = pinsFromCatalog(catalog);
    expect(verifyPinnedCertificate(pins, "192.168.1.10", PINNED_PEM!)).toBe(0);
    expect(verifyPinnedCertificate(pins, "[fd12::10]", PINNED_PEM!)).toBe(0);
    // A publicly trusted certificate for a pinned host is refused, not handed to Chromium.
    expect(verifyPinnedCertificate(pins, "192.168.1.10", PUBLIC_CA_PEM!)).toBe(-2);
  });

  it("leaves every other host to Chromium, so the pinned certificate proves nothing there", () => {
    const pins = pinsFromCatalog(catalog);
    expect(verifyPinnedCertificate(pins, "192.168.1.11", PINNED_PEM!)).toBe(-3);
    expect(verifyPinnedCertificate(pins, "box.example.ts.net", PINNED_PEM!)).toBe(-3);
    expect(verifyPinnedCertificate(new Map(), "192.168.1.10", PINNED_PEM!)).toBe(-3);
  });
});
