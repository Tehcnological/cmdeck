import * as Context from "effect/Context";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { AuthClientMetadata } from "@t3tools/contracts";

import { type AuthPairingLinkRepositoryError, PersistenceSqlError } from "./Errors.ts";

/** A device that redeemed a direct pairing link while approval is required. Fork-only table. */
const AuthPairingRequestRecord = Schema.Struct({
  pairingLinkId: Schema.String,
  requestedAt: Schema.DateTimeUtcFromString,
  /** Denied if nobody answers by then; once approved, the device must be back by then. */
  expiresAt: Schema.DateTimeUtcFromString,
  /** The key the first request proved, which an approved redemption must prove again. */
  proofKeyThumbprint: Schema.NullOr(Schema.String),
  client: Schema.NullOr(Schema.fromJsonString(AuthClientMetadata)),
  approvedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type AuthPairingRequestRecord = typeof AuthPairingRequestRecord.Type;

const OpenInput = Schema.Struct({
  pairingLinkId: Schema.String,
  requestedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  proofKeyThumbprint: Schema.NullOr(Schema.String),
  client: Schema.NullOr(Schema.fromJsonString(AuthClientMetadata)),
});

const ApproveInput = Schema.Struct({
  pairingLinkId: Schema.String,
  approvedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
});

const ExtendLinkInput = Schema.Struct({
  pairingLinkId: Schema.String,
  expiresAt: Schema.DateTimeUtcFromString,
});

const IdInput = Schema.Struct({ pairingLinkId: Schema.String });
const NowInput = Schema.Struct({ now: Schema.DateTimeUtcFromString });

export class AuthPairingRequestRepository extends Context.Service<
  AuthPairingRequestRepository,
  {
    readonly get: (
      pairingLinkId: string,
    ) => Effect.Effect<Option.Option<AuthPairingRequestRecord>, AuthPairingLinkRepositoryError>;
    /** Records the first request for a link and keeps the link alive until it expires. */
    readonly open: (
      input: typeof OpenInput.Type,
    ) => Effect.Effect<void, AuthPairingLinkRepositoryError>;
    /** False when the request is gone, answered, expired, or its link is no longer usable. */
    readonly approve: (
      input: typeof ApproveInput.Type,
    ) => Effect.Effect<boolean, AuthPairingLinkRepositoryError>;
    /** Requests whose links are still unspent, unrevoked and unexpired. */
    readonly listForActiveLinks: (
      now: DateTime.Utc,
    ) => Effect.Effect<ReadonlyArray<AuthPairingRequestRecord>, AuthPairingLinkRepositoryError>;
  }
>()("t3/persistence/AuthPairingRequests/AuthPairingRequestRepository") {}

const sqlError = (operation: string) => (cause: unknown) =>
  new PersistenceSqlError({ operation, cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const selectColumns = sql`
    SELECT
      pairing_link_id AS "pairingLinkId",
      requested_at AS "requestedAt",
      expires_at AS "expiresAt",
      proof_key_thumbprint AS "proofKeyThumbprint",
      client_json AS "client",
      approved_at AS "approvedAt"
    FROM auth_pairing_requests
  `;

  const getRow = SqlSchema.findOneOption({
    Request: IdInput,
    Result: AuthPairingRequestRecord,
    execute: ({ pairingLinkId }) =>
      sql`
        ${selectColumns}
        WHERE pairing_link_id = ${pairingLinkId}
      `,
  });

  const insertRow = SqlSchema.void({
    Request: OpenInput,
    execute: ({ pairingLinkId, requestedAt, expiresAt, proofKeyThumbprint, client }) =>
      sql`
        INSERT INTO auth_pairing_requests (
          pairing_link_id, requested_at, expires_at, proof_key_thumbprint, client_json, approved_at
        )
        VALUES (${pairingLinkId}, ${requestedAt}, ${expiresAt}, ${proofKeyThumbprint}, ${client}, NULL)
        ON CONFLICT (pairing_link_id) DO NOTHING
      `,
  });

  const extendLinkRow = SqlSchema.void({
    Request: ExtendLinkInput,
    execute: ({ pairingLinkId, expiresAt }) =>
      sql`
        UPDATE auth_pairing_links
        SET expires_at = MAX(expires_at, ${expiresAt})
        WHERE id = ${pairingLinkId}
      `,
  });

  const approveRows = SqlSchema.findAll({
    Request: ApproveInput,
    Result: IdInput,
    execute: ({ pairingLinkId, approvedAt, expiresAt }) =>
      sql`
        UPDATE auth_pairing_requests
        SET approved_at = ${approvedAt}, expires_at = ${expiresAt}
        WHERE pairing_link_id = ${pairingLinkId}
          AND approved_at IS NULL
          AND expires_at > ${approvedAt}
          AND pairing_link_id IN (
            SELECT id FROM auth_pairing_links
            WHERE revoked_at IS NULL AND consumed_at IS NULL AND expires_at > ${approvedAt}
          )
        RETURNING pairing_link_id AS "pairingLinkId"
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: NowInput,
    Result: AuthPairingRequestRecord,
    execute: ({ now }) =>
      sql`
        ${selectColumns}
        WHERE pairing_link_id IN (
          SELECT id FROM auth_pairing_links
          WHERE revoked_at IS NULL AND consumed_at IS NULL AND expires_at > ${now}
        )
      `,
  });

  const get: AuthPairingRequestRepository["Service"]["get"] = (pairingLinkId) =>
    getRow({ pairingLinkId }).pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError(sqlError("AuthPairingRequestRepository.get")),
    );

  const open: AuthPairingRequestRepository["Service"]["open"] = (input) =>
    insertRow(input).pipe(
      Effect.andThen(extendLinkRow(input)),
      sql.withTransaction,
      Effect.mapError(sqlError("AuthPairingRequestRepository.open")),
    );

  const approve: AuthPairingRequestRepository["Service"]["approve"] = (input) =>
    approveRows(input).pipe(
      Effect.tap((rows) => (rows.length > 0 ? extendLinkRow(input) : Effect.void)),
      sql.withTransaction,
      Effect.map((rows) => rows.length > 0),
      Effect.mapError(sqlError("AuthPairingRequestRepository.approve")),
    );

  const listForActiveLinks: AuthPairingRequestRepository["Service"]["listForActiveLinks"] = (
    now,
  ) =>
    listRows({ now }).pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError(sqlError("AuthPairingRequestRepository.listForActiveLinks")),
    );

  return {
    get,
    open,
    approve,
    listForActiveLinks,
  } satisfies AuthPairingRequestRepository["Service"];
});

export const layer = Layer.effect(AuthPairingRequestRepository, make);
