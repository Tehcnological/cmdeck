import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ASSET_TRANSFER_CHUNK_BYTES } from "@t3tools/contracts";
import { E2EE_REQUIRED_CODE } from "@t3tools/shared/socketE2ee";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpRouter } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerHttp from "../http.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as BuiltInDrivers from "../sourceControl/builtInDrivers.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as T3ProjectFileLoader from "../project/T3ProjectFileLoader.ts";
import * as DocumentText from "../provider/DocumentText.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { issueAssetUrl } from "./AssetAccess.ts";
import * as AssetSigner from "./AssetSigner.ts";
import { readAssetStream, uploadAttachmentChunk } from "./AssetTransfer.ts";
import { issueAttachmentUploadUrl } from "./AttachmentUpload.ts";
import * as NativeAppIconResolver from "./NativeAppIconResolver.ts";
import * as WorkspacePreviewRevisions from "./WorkspacePreviewRevisions.ts";

/** One environment: its own data dir, so its own signing key. */
const environment = (prefix: string) => {
  const config = ServerConfig.layerTest(process.cwd(), { prefix });
  return Layer.mergeAll(
    Layer.mock(Orchestrator.OrchestratorV2)({ getTurnItem: () => Effect.succeed(null) }),
    config,
    WorkspacePaths.layer,
    ProjectFaviconResolver.layer.pipe(
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(T3ProjectFileLoader.layer),
    ),
    NativeAppIconResolver.layer.pipe(Layer.provide(config)),
    AssetSigner.layer.pipe(Layer.provideMerge(ServerSecretStore.layer.pipe(Layer.provide(config)))),
    WorkspacePreviewRevisions.layer,
    DocumentText.layer,
  ).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));
};

const layerHost = environment("t3-asset-transfer-");
// Fresh: layers are memoized by reference, and the other host must not share this one's key.
const layerOtherHost = Layer.fresh(environment("t3-asset-transfer-other-"));

const bytesOf = (length: number) => {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index++) bytes[index] = (index * 31 + 7) % 251;
  return bytes;
};

const uploadInChunks = (relativeUrl: string, bytes: Uint8Array) =>
  Effect.gen(function* () {
    let last = { receivedBytes: 0, complete: false };
    for (let offset = 0; offset < bytes.byteLength; offset += ASSET_TRANSFER_CHUNK_BYTES) {
      last = yield* uploadAttachmentChunk({
        relativeUrl,
        offset,
        data: bytes.subarray(offset, offset + ASSET_TRANSFER_CHUNK_BYTES),
      });
    }
    return last;
  });

const readAll = (relativeUrl: string) =>
  readAssetStream(relativeUrl).pipe(
    Stream.runCollect,
    Effect.map((chunks) => {
      const all = [...chunks];
      const total = all.reduce((sum, chunk) => sum + chunk.data.byteLength, 0);
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const chunk of all) {
        joined.set(chunk.data, offset);
        offset += chunk.data.byteLength;
      }
      return { first: all[0], chunkCount: all.length, bytes: joined };
    }),
  );

describe("AssetTransfer", () => {
  it.effect("uploads in chunks and reads the attachment back over RPC", () =>
    Effect.gen(function* () {
      const bytes = bytesOf(ASSET_TRANSFER_CHUNK_BYTES * 2 + 1234);
      const upload = yield* issueAttachmentUploadUrl({
        name: "shot.png",
        mimeType: "image/png",
        sizeBytes: bytes.byteLength,
      });
      expect(yield* uploadInChunks(upload.relativeUrl, bytes)).toEqual({
        receivedBytes: bytes.byteLength,
        complete: true,
      });

      const asset = yield* issueAssetUrl({
        resource: {
          _tag: "attachment",
          attachmentId: upload.attachmentId,
          mimeType: "image/png",
          disposition: "inline",
        },
      });
      const read = yield* readAll(asset.relativeUrl);
      expect(read.bytes).toEqual(bytes);
      expect(read.chunkCount).toBeGreaterThan(1);
      expect(read.first).toMatchObject({ totalBytes: bytes.byteLength });
      expect(read.first?.contentType).toBeTypeOf("string");
    }).pipe(Effect.provide(layerHost)),
  );

  it.effect("refuses chunks out of order, oversized, past the end, or under a forged token", () =>
    Effect.gen(function* () {
      const bytes = bytesOf(ASSET_TRANSFER_CHUNK_BYTES + 10);
      const upload = yield* issueAttachmentUploadUrl({
        type: "file",
        name: "notes.bin",
        mimeType: "application/octet-stream",
        sizeBytes: bytes.byteLength,
      });
      const fail = (input: Parameters<typeof uploadAttachmentChunk>[0]) =>
        Effect.flip(uploadAttachmentChunk(input));

      expect(
        yield* fail({ relativeUrl: upload.relativeUrl, offset: 10, data: bytes.subarray(0, 10) }),
      ).toMatchObject({ _tag: "AttachmentUploadChunkError", status: 409 });
      expect(
        yield* fail({
          relativeUrl: upload.relativeUrl,
          offset: 0,
          data: new Uint8Array(ASSET_TRANSFER_CHUNK_BYTES + 1),
        }),
      ).toMatchObject({ status: 400 });
      expect(
        yield* fail({ relativeUrl: upload.relativeUrl, offset: bytes.byteLength, data: bytes }),
      ).toMatchObject({ status: 400 });
      const [payload] = upload.relativeUrl.split(".");
      expect(
        yield* fail({ relativeUrl: `${payload}.forged`, offset: 0, data: bytes.subarray(0, 1) }),
      ).toMatchObject({ status: 404 });
      // Nothing was published by the refused chunks.
      expect(yield* uploadInChunks(upload.relativeUrl, bytes)).toMatchObject({ complete: true });
    }).pipe(Effect.provide(layerHost)),
  );

  it.effect("only reads with a URL this environment signed and that has not expired", () =>
    Effect.gen(function* () {
      const bytes = bytesOf(64);
      const upload = yield* issueAttachmentUploadUrl({
        name: "a.png",
        mimeType: "image/png",
        sizeBytes: bytes.byteLength,
      });
      yield* uploadInChunks(upload.relativeUrl, bytes);
      const asset = yield* issueAssetUrl({
        resource: { _tag: "attachment", attachmentId: upload.attachmentId },
      });

      // Another environment's key does not verify this signature, nor an upload URL from here.
      expect(
        yield* Effect.flip(readAll(asset.relativeUrl)).pipe(Effect.provide(layerOtherHost)),
      ).toMatchObject({ _tag: "AssetReadError", reason: "not-found" });
      expect(
        yield* Effect.flip(
          uploadAttachmentChunk({ relativeUrl: upload.relativeUrl, offset: 0, data: bytes }),
        ).pipe(Effect.provide(layerOtherHost)),
      ).toMatchObject({ status: 404 });

      // An upload URL is not an asset URL, and a tampered path is not either.
      expect(yield* Effect.flip(readAll(upload.relativeUrl))).toMatchObject({
        reason: "not-found",
      });
      const [token] = asset.relativeUrl.slice("/api/assets/".length).split("/");
      expect(
        yield* Effect.flip(readAll(`/api/assets/${token?.slice(0, -2)}xx/file`)),
      ).toMatchObject({ reason: "not-found" });

      yield* TestClock.adjust("2 hours");
      expect(yield* Effect.flip(readAll(asset.relativeUrl))).toMatchObject({
        reason: "not-found",
      });
    }).pipe(Effect.provide(layerHost)),
  );
});

describe("plain HTTP transfer routes under e2eeMode", () => {
  const serve = (e2eeMode: "prefer" | "require") =>
    Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(
          Layer.mergeAll(ServerHttp.layerAttachmentUploadRoute, ServerHttp.layerAssetRoute).pipe(
            Layer.provideMerge(ServerSettings.layerTest({ e2eeMode })),
            Layer.provideMerge(layerHost),
            Layer.provideMerge(NodeHttpPlatform.layer),
            Layer.provideMerge(Layer.succeed(BuiltInDrivers.SourceControlDrivers, [])),
            Layer.provideMerge(
              Layer.mock(RepositoryIdentityResolver.RepositoryIdentityResolver)({
                resolve: () => Effect.succeed(null),
              }),
            ),
          ),
          { disableLogger: true },
        ),
      ),
      ({ dispose }) => Effect.promise(() => dispose()),
    );

  it.effect.each(["prefer", "require"] as const)(
    "a remote request is refused only under %s=require",
    (e2eeMode) =>
      Effect.gen(function* () {
        const { handler } = yield* serve(e2eeMode);
        // A web Request has no peer address, so it classifies as remote.
        for (const [method, path] of [
          ["GET", "/api/assets/bogus.token/file.png"],
          ["POST", "/api/attachments/upload/bogus.token"],
        ] as const) {
          const response = yield* Effect.promise(() =>
            handler(new Request(`http://203.0.113.9:3773${path}`, { method })),
          );
          if (e2eeMode === "require") {
            expect(response.status).toBe(403);
            expect(yield* Effect.promise(() => response.json())).toMatchObject({
              code: E2EE_REQUIRED_CODE,
            });
          } else {
            expect(response.status).toBe(404);
          }
        }
      }).pipe(Effect.scoped),
  );
});
