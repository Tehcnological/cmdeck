import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { requestGuarded } from "@t3tools/client-runtime/rpc";
import { createEnvironmentQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useGT } from "gt-react";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { useSettingsScope } from "../../components/settings/SettingsScopeContext";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  embedderOptions,
  embedderValue,
  KEYWORDS_ONLY,
  settingForValue,
} from "./memoryEmbeddings.logic";

const embeddingsStatus = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:memory-embeddings-status",
  staleTimeMs: 0,
  execute: () => requestGuarded(CMDECK_WS_METHODS.memoryEmbeddingsStatus, {}),
});

/** Settings > General: the optional embedder for memory search (WI-2.08). Shown while memory is on. */
export function MemoryEmbeddingsSection() {
  const { environment } = useSettingsScope();
  return environment === null ? null : (
    <MemoryEmbeddings key={environment.environmentId} environmentId={environment.environmentId} />
  );
}

function MemoryEmbeddings({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const memoryEnabled = useEnvironmentSettings(
    environmentId,
    (settings) => settings.cmdeck.memoryEnabled,
  );
  const current = useEnvironmentSettings(
    environmentId,
    (settings) => settings.cmdeck.memoryEmbedder,
  );
  const snapshots = useAtomValue(serverEnvironment.inferenceServersValueAtom(environmentId));
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings);
  const statusQuery = embeddingsStatus({ environmentId, input: {} });
  const status = AsyncResult.getOrElse(useAtomValue(statusQuery), () => null);
  const refresh = useAtomRefresh(statusQuery);

  if (!memoryEnabled) return null;
  const options = embedderOptions(snapshots ?? [], current);
  const selected = options.find((option) => option.value === embedderValue(current));

  return (
    <SettingsSection
      id="memory-search"
      title={gt("Memory search", { $context: "settings section" })}
    >
      <SettingsRow
        title={gt("Search by meaning")}
        description={gt(
          "Embeds memory with a model on one of your local inference servers, so a turn finds facts worded differently. Nothing is downloaded, and keyword-only search makes no network request.",
        )}
        control={
          <Select
            value={embedderValue(current)}
            disabled={!canWrite}
            onValueChange={(value) => {
              if (value === null) return;
              void updateSettings({
                environmentId,
                input: {
                  patch: { cmdeck: { memoryEmbedder: settingForValue(options, value) } },
                },
              }).then(refresh);
            }}
          >
            <SelectTrigger aria-label={gt("Embedding model")} className="min-w-48" size="xs">
              <SelectValue>
                {selected === undefined
                  ? gt("Keywords only")
                  : `${selected.serverName} · ${selected.setting.model}`}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={KEYWORDS_ONLY}>{gt("Keywords only")}</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {`${option.serverName} · ${option.setting.model}`}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {status === null || status.mode === "keyword" ? null : (
        <SettingsRow
          title={
            status.mode === "hybrid"
              ? gt("{embedded} of {total} items embedded", {
                  embedded: status.embedded,
                  total: status.total,
                })
              : gt("Unavailable, so search uses keywords")
          }
          description={status.mode === "unavailable" ? status.message : undefined}
          control={
            <Button size="xs" variant="outline" onClick={refresh}>
              {gt("Refresh")}
            </Button>
          }
        />
      )}
    </SettingsSection>
  );
}
