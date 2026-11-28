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
      [CMDECK_WS_METHODS.memoryEmbeddingsStatus],
      AuthOrchestrationReadScope,
    );
  });

  // A client-guarded method needs a command boundary; query atoms read with `request`.
  it("are not client-guarded, so query atoms can read them", () => {
    for (const method of Object.keys(FORK_RPC_READ_SCOPES)) {
      expect(clientRpcRequiredScopes(method, {})).toEqual([]);
    }
  });
});
