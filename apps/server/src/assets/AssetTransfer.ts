/**
 * CMDeck: asset downloads and attachment uploads over the RPC socket. On a pinned E2EE session
 * that socket is end-to-end encrypted, so the bytes never cross a TLS-terminating hop in the
 * clear. Authorization is the signed URL, verified by the same code the HTTP routes use; the RPC
 * layer additionally requires the session scope that mints such a URL.
 */
import {
  ASSET_TRANSFER_CHUNK_BYTES,
  AssetReadError,
  AttachmentUploadChunkError,
  type AssetReadChunk,
  type AttachmentUploadChunkInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Mime from "effect/http/Mime";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import * as ServerConfig from "../config.ts";
import { assetResponseHeaders } from "../http.ts";
import { ASSET_ROUTE_PREFIX, resolveAsset, type ResolvedAsset } from "./AssetAccess.ts";
import {
  ATTACHMENT_UPLOAD_ROUTE_PREFIX,
  storeAttachmentUpload,
  validateAttachmentUploadToken,
} from "./AttachmentUpload.ts";
import { statMediaFile, streamMediaFile } from "./MediaFile.ts";

const notFound = () => new AssetReadError({ reason: "not-found" });
const readFailed = () => new AssetReadError({ reason: "failed" });

/** Splits `/api/assets/<token>/<path>` the way the HTTP route does. */
function parseAssetUrl(relativeUrl: string) {
  if (!relativeUrl.startsWith(`${ASSET_ROUTE_PREFIX}/`)) return null;
  const suffix = relativeUrl.slice(`${ASSET_ROUTE_PREFIX}/`.length);
  const separatorIndex = suffix.indexOf("/");
  if (separatorIndex <= 0) return null;
  return { token: suffix.slice(0, separatorIndex), path: suffix.slice(separatorIndex + 1) };
}

function rechunk(bytes: Uint8Array): ReadonlyArray<Uint8Array> {
  const chunks: Array<Uint8Array> = [];
  for (let offset = 0; offset < bytes.byteLength; offset += ASSET_TRANSFER_CHUNK_BYTES) {
    chunks.push(bytes.subarray(offset, offset + ASSET_TRANSFER_CHUNK_BYTES));
  }
  return chunks.length > 0 ? chunks : [new Uint8Array(0)];
}

/** Every chunk is data; the first also says what the bytes are. An empty file sends one. */
const withHeader = <E, R>(
  contentType: string,
  totalBytes: number,
  body: Stream.Stream<Uint8Array, E, R>,
): Stream.Stream<AssetReadChunk, E, R> =>
  (totalBytes === 0 ? Stream.make(new Uint8Array(0)) : body).pipe(
    Stream.mapAccum(
      () => true,
      (first, data): readonly [boolean, ReadonlyArray<AssetReadChunk>] => [
        false,
        [first ? { data, contentType, totalBytes } : { data }],
      ],
    ),
  );

/**
 * Streams the bytes the HTTP asset route would serve for this signed URL. Source-control media is
 * fetched from its host with the server's credential and is not an attachment, so it stays on
 * HTTP.
 */
export const readAssetStream = (relativeUrl: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const parsed = parseAssetUrl(relativeUrl);
      if (parsed === null) return yield* notFound();
      const asset = yield* resolveAsset(parsed.token, parsed.path);
      if (!asset) return yield* notFound();
      if (asset.kind === "bytes") {
        return withHeader(
          asset.mimeType,
          asset.bytes.byteLength,
          Stream.fromIterable(rechunk(asset.bytes)),
        );
      }
      if (asset.kind === "source-control-media") {
        return yield* new AssetReadError({ reason: "unsupported" });
      }
      const file: Extract<ResolvedAsset, { kind: "file" }> = asset;
      const contentType =
        assetResponseHeaders(file.path, file)["Content-Type"] ??
        Option.getOrElse(Mime.getType(asset.path), () => "application/octet-stream");
      if (file.file) {
        // Keeps reading the descriptor the asset resolver validated.
        const info = yield* statMediaFile(file.path, file.file).pipe(Effect.mapError(readFailed));
        const body = info.size === 0n ? Stream.empty : streamMediaFile(file.file, 0n, info.size);
        if (body === null) return yield* readFailed();
        return withHeader(contentType, Number(info.size), Stream.mapError(body, readFailed));
      }
      const fileSystem = yield* FileSystem.FileSystem;
      const info = yield* fileSystem.stat(asset.path).pipe(Effect.mapError(readFailed));
      if (info.type !== "File") return yield* notFound();
      return withHeader(
        contentType,
        Number(info.size),
        fileSystem
          .stream(asset.path, { chunkSize: ASSET_TRANSFER_CHUNK_BYTES })
          .pipe(Stream.mapError(readFailed)),
      );
    }).pipe(
      Effect.catchDefect((cause) =>
        Effect.logError("Failed to read asset over RPC.", { cause }).pipe(
          Effect.andThen(Effect.fail(readFailed())),
        ),
      ),
    ),
  );

const chunkError = (status: number, detail: string) =>
  new AttachmentUploadChunkError({ status, detail });

/**
 * Appends one chunk of an upload minted by `attachments.createUploadUrl`. Chunks must arrive in
 * order; offset 0 restarts the upload. The last chunk publishes the file through the same code
 * as the HTTP upload route, which re-checks the size and refuses a second, different upload.
 */
export const uploadAttachmentChunk = Effect.fn("AssetTransfer.uploadAttachmentChunk")(function* (
  input: AttachmentUploadChunkInput,
) {
  if (!input.relativeUrl.startsWith(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`)) {
    return yield* chunkError(404, "Not Found");
  }
  const claims = yield* validateAttachmentUploadToken(
    input.relativeUrl.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length),
  );
  if (!claims) return yield* chunkError(404, "Not Found");
  const length = input.data.byteLength;
  if (length === 0 || length > ASSET_TRANSFER_CHUNK_BYTES) {
    return yield* chunkError(400, `Chunks must be 1 to ${ASSET_TRANSFER_CHUNK_BYTES} bytes.`);
  }
  if (input.offset + length > claims.sizeBytes) {
    return yield* chunkError(400, "Chunk runs past the upload size.");
  }

  const config = yield* ServerConfig.ServerConfig;
  // Ends in `.part`, so the pending sweep removes an abandoned one.
  const stagingPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${claims.attachmentId}.rpc-upload.part`,
  });
  if (!stagingPath) return yield* chunkError(500, "Failed to resolve attachment path.");
  const fileSystem = yield* FileSystem.FileSystem;
  const persistFailed = (cause: unknown) =>
    Effect.logError("Failed to stage attachment upload chunk.", {
      attachmentId: claims.attachmentId,
      cause,
    }).pipe(Effect.andThen(Effect.fail(chunkError(500, "Failed to persist upload."))));

  if (input.offset > 0) {
    const staged = yield* fileSystem.stat(stagingPath).pipe(
      Effect.map((info) => Number(info.size)),
      Effect.orElseSucceed(() => 0),
    );
    if (staged !== input.offset) {
      return yield* chunkError(409, `Expected offset ${staged}, got ${input.offset}.`);
    }
  } else {
    yield* fileSystem
      .makeDirectory(config.attachmentsDir, { recursive: true })
      .pipe(Effect.catch(persistFailed));
  }
  yield* fileSystem
    .writeFile(stagingPath, input.data, { flag: input.offset === 0 ? "w" : "a" })
    .pipe(Effect.catch(persistFailed));

  const receivedBytes = input.offset + length;
  if (receivedBytes < claims.sizeBytes) return { receivedBytes, complete: false };

  const stored = yield* storeAttachmentUpload(claims, fileSystem.stream(stagingPath)).pipe(
    Effect.ensuring(fileSystem.remove(stagingPath, { force: true }).pipe(Effect.ignore)),
  );
  if (!stored.ok) return yield* chunkError(stored.status, stored.detail);
  return { receivedBytes, complete: true };
});
