import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../../connection/runtime";

export const knowledgeList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:knowledge-list",
  tag: CMDECK_WS_METHODS.knowledgeList,
  staleTimeMs: 0,
});

export const addKnowledgeSource = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:knowledge-add-source",
  tag: CMDECK_WS_METHODS.knowledgeAddSource,
});

export const removeKnowledgeSource = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:knowledge-remove-source",
  tag: CMDECK_WS_METHODS.knowledgeRemoveSource,
});

export const reindexKnowledgeSource = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:knowledge-reindex",
  tag: CMDECK_WS_METHODS.knowledgeReindex,
});

export const cancelKnowledgeIndex = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:knowledge-cancel",
  tag: CMDECK_WS_METHODS.knowledgeCancel,
});
