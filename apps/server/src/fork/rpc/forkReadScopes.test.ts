import {
  AuthOrchestrationReadScope,
  clientRpcRequiredScopes,
  CMDECK_WS_METHODS,
  FORK_RPC_READ_SCOPES,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import * as RpcAuthorization from "../../auth/RpcAuthorization.ts";

describe("fork read scopes", () => {
  it("are checked by the server", () => {
    for (const [method, scope] of Object.entries(FORK_RPC_READ_SCOPES)) {
      expect(RpcAuthorization.RPC_REQUIRED_SCOPES).toHaveProperty([method], scope);
    }
    expect(RpcAuthorization.RPC_REQUIRED_SCOPES).toHaveProperty(
      [CMDECK_WS_METHODS.notificationChannelsList],
      AuthOrchestrationReadScope,
    );
    expect(RpcAuthorization.RPC_REQUIRED_SCOPES).toHaveProperty(
      [CMDECK_WS_METHODS.workLedgerList],
      AuthOrchestrationReadScope,
    );
    expect(RpcAuthorization.RPC_REQUIRED_SCOPES).toHaveProperty(
      [CMDECK_WS_METHODS.checkScriptsList],
      AuthOrchestrationReadScope,
    );
    expect(RpcAuthorization.RPC_REQUIRED_SCOPES).toHaveProperty(
      [CMDECK_WS_METHODS.botsList],
      AuthOrchestrationReadScope,
    );
    for (const method of [
      CMDECK_WS_METHODS.memoryList,
      CMDECK_WS_METHODS.memoryRevisions,
      CMDECK_WS_METHODS.memoryPreviewEdit,
      CMDECK_WS_METHODS.memoryThreadMode,
      CMDECK_WS_METHODS.memoryInjections,
      // Settings and the palette read the container status from query atoms.
      CMDECK_WS_METHODS.sandboxStatus,
    ]) {
      expect(RpcAuthorization.RPC_REQUIRED_SCOPES).toHaveProperty(
        [method],
        AuthOrchestrationReadScope,
      );
      expect(clientRpcRequiredScopes(method, {})).toEqual([]);
    }
    expect(RpcAuthorization.RPC_REQUIRED_SCOPES).toHaveProperty(
      [CMDECK_WS_METHODS.memoryEmbeddingsStatus],
      AuthOrchestrationReadScope,
    );
  });

  // A client-guarded method needs a command boundary; query atoms read with `request`.
  it("are not client-guarded, so query atoms can read them", () => {
    for (const method of Object.keys(FORK_RPC_READ_SCOPES)) {
      expect(clientRpcRequiredScopes(method, {})).toEqual([]);
    }
    expect(clientRpcRequiredScopes(CMDECK_WS_METHODS.workLedgerList, {})).toEqual([]);
  });
});
