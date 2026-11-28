import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import {
  CMDECK_WS_METHODS,
  type EnvironmentId,
  type HeartbeatCheck,
  type HeartbeatSettings,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useGT } from "gt-react";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { useSettingsScope } from "../../components/settings/SettingsScopeContext";
import { useSearchableSetting } from "../../components/settings/settingsSearch";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { formatProbeLines, parseProbeLines, sameProbes } from "./heartbeat.logic";

const heartbeatStatus = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:heartbeat-status",
  tag: CMDECK_WS_METHODS.heartbeatStatus,
  staleTimeMs: 0,
});

/** Settings > General: health monitoring (WI-2.12): stalled turns, linked environments, probes. */
export function HeartbeatSection() {
  const { environment } = useSettingsScope();
  return environment === null ? null : (
    <HeartbeatSettingsPanel
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  );
}

function HeartbeatSettingsPanel({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const heartbeat = useEnvironmentSettings(environmentId, (settings) => settings.cmdeck.heartbeat);
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const statusQuery = heartbeatStatus({ environmentId, input: {} });
  const status = AsyncResult.getOrElse(useAtomValue(statusQuery), () => null);
  const refresh = useAtomRefresh(statusQuery);

  const savedProbes = formatProbeLines(heartbeat.probes);
  const [probes, setProbes] = useState({ saved: savedProbes, draft: savedProbes });
  if (probes.saved !== savedProbes) setProbes({ saved: savedProbes, draft: savedProbes });
  const parsed = parseProbeLines(probes.draft);
  const savedStall = String(heartbeat.sessionStallMinutes);
  const [stall, setStall] = useState({ saved: savedStall, draft: savedStall });
  if (stall.saved !== savedStall) setStall({ saved: savedStall, draft: savedStall });
  const stallMinutes = Number(stall.draft);
  const stallValid = Number.isInteger(stallMinutes) && stallMinutes >= 1 && stallMinutes <= 240;

  // The status follows each save, so turning it on shows what the first pass found.
  const save = (patch: Partial<HeartbeatSettings>, onFailed?: () => void) =>
    updateSettings(
      { cmdeck: { heartbeat: patch } },
      { onSaved: refresh, ...(onFailed ? { onFailed } : {}) },
    );

  const saveProbes = () => {
    if (!parsed.ok || sameProbes(parsed.probes, heartbeat.probes)) return;
    save({ probes: [...parsed.probes] }, () =>
      setProbes({ saved: savedProbes, draft: savedProbes }),
    );
  };
  const saveStall = () => {
    if (!stallValid || stallMinutes === heartbeat.sessionStallMinutes) return;
    save({ sessionStallMinutes: stallMinutes }, () =>
      setStall({ saved: savedStall, draft: savedStall }),
    );
  };

  const probeError = parsed.ok
    ? null
    : parsed.reason === "count"
      ? gt("List at most 20 probes.")
      : parsed.reason === "name"
        ? gt("Line {line}: give the probe a name before the equals sign.", { line: parsed.line })
        : gt("Line {line}: use an http:// or https:// URL, or host:port for a TCP check.", {
            line: parsed.line,
          });

  return (
    <SettingsSection id="heartbeat" title={gt("Health monitoring")}>
      <SettingsRow
        {...searchableSetting("heartbeat")}
        title={gt("Watch for things that stop responding")}
        description={gt(
          "Every minute, checks that running turns still hear from their provider and that your probes answer. Alerts once when something stops responding and once when it recovers, through your notification channels and the open app. No model is used.",
        )}
        control={
          <Switch
            checked={heartbeat.enabled}
            disabled={!canWrite}
            aria-label={gt("Health monitoring")}
            onCheckedChange={(enabled) => save({ enabled })}
          />
        }
      />
      {heartbeat.enabled ? (
        <>
          <SettingsRow
            title={gt("Stalled turn after")}
            description={gt("Minutes a running turn may go without a provider event.")}
            control={
              <Input
                size="sm"
                className="w-20"
                inputMode="numeric"
                value={stall.draft}
                disabled={!canWrite}
                aria-invalid={!stallValid}
                aria-label={gt("Minutes before a running turn counts as stalled")}
                onChange={(event) =>
                  setStall({ saved: savedStall, draft: event.currentTarget.value })
                }
                onBlur={saveStall}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveStall();
                  if (event.key === "Escape") setStall({ saved: savedStall, draft: savedStall });
                }}
              />
            }
          />
          <SettingsRow
            title={gt("Check linked environments")}
            description={gt(
              "Also asks each linked environment whether it answers, as Settings > Linked environments does.",
            )}
            control={
              <Switch
                checked={heartbeat.environments}
                disabled={!canWrite}
                aria-label={gt("Check linked environments")}
                onCheckedChange={(environments) => save({ environments })}
              />
            }
          />
          <SettingsRow
            title={gt("Probes")}
            description={
              probeError ??
              gt(
                "One per line as name = target: an http(s) URL that should answer with a success status, or host:port for a TCP port. These are the only requests the heartbeat makes.",
              )
            }
          >
            <Textarea
              className="mt-2"
              rows={4}
              value={probes.draft}
              disabled={!canWrite}
              aria-invalid={!parsed.ok}
              aria-label={gt("Heartbeat probes")}
              onChange={(event) =>
                setProbes({ saved: savedProbes, draft: event.currentTarget.value })
              }
              onBlur={saveProbes}
            />
          </SettingsRow>
          <SettingsRow
            title={gt("Current state")}
            description={
              status === null || status.checks.length === 0
                ? gt("Nothing to watch right now.")
                : undefined
            }
            control={
              <Button size="xs" variant="outline" onClick={refresh}>
                {gt("Refresh")}
              </Button>
            }
          >
            {status === null || status.checks.length === 0 ? null : (
              <ul className="mt-2 flex flex-col gap-1 text-xs">
                {status.checks.map((check) => (
                  <CheckRow key={check.key} check={check} />
                ))}
              </ul>
            )}
          </SettingsRow>
        </>
      ) : null}
    </SettingsSection>
  );
}

function CheckRow({ check }: { readonly check: HeartbeatCheck }) {
  const gt = useGT();
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className={check.up ? "text-success" : "text-destructive"}>
        {check.up ? gt("Responding") : gt("Not responding")}
      </span>
      <span className="min-w-0 truncate text-foreground">{check.label}</span>
      {check.detail === null ? null : (
        <span className="min-w-0 text-muted-foreground">{check.detail}</span>
      )}
    </li>
  );
}

export const settingsSection = {
  page: "general",
  order: 22,
  Component: HeartbeatSection,
} as const;
