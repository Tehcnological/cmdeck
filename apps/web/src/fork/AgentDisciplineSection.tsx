import {
  type AgentDisciplineSettings,
  DEFAULT_AGENT_DISCIPLINE,
  type EnvironmentId,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useState } from "react";

import {
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { useSearchableSetting } from "../components/settings/settingsSearch";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { useUpdateEnvironmentSettings } from "../hooks/useSettings";

type CountKey = Exclude<keyof AgentDisciplineSettings, "enabled">;

const MAXIMUMS: Record<CountKey, number> = {
  subagentCap: 32,
  reviewRoundCap: 20,
  checkpointMinutes: 240,
  stallLimit: 50,
};

/** Settings > Providers: how agents work by default (subagent budget, review rounds, checkpoints). */
export function AgentDisciplineSection({
  environmentId,
  settings,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly settings: Pick<UnifiedSettings, "cmdeck">;
  readonly readOnly: boolean;
}) {
  const discipline = settings.cmdeck.agentDiscipline;
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const save = (patch: Partial<AgentDisciplineSettings>) =>
    updateSettings({ cmdeck: { agentDiscipline: patch } });

  const count = (key: CountKey, label: string) => (
    <CountInput
      key={`${key}:${discipline[key]}`}
      value={discipline[key]}
      maximum={MAXIMUMS[key]}
      label={label}
      disabled={readOnly || !discipline.enabled}
      onSave={(value) => save({ [key]: value })}
    />
  );
  const reset = (key: CountKey, label: string) =>
    !readOnly && discipline[key] !== DEFAULT_AGENT_DISCIPLINE[key] ? (
      <SettingResetButton
        ariaLabel={label}
        onClick={() => save({ [key]: DEFAULT_AGENT_DISCIPLINE[key] })}
      />
    ) : null;

  return (
    <SettingsSection title={gt("Agent discipline")}>
      <SettingsRow
        {...searchableSetting("agent-discipline")}
        description={gt(
          "Agents name a done-check and run it after each change, keep a short change log, pass tests, lint, typecheck and the done-check before a PR's review bot runs, and work mostly on their own. Antigravity and other ACP agents are left as they are.",
        )}
        control={
          <Switch
            checked={discipline.enabled}
            disabled={readOnly}
            onCheckedChange={(checked) => save({ enabled: Boolean(checked) })}
            aria-label={gt("Agent discipline")}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("agent-subagent-cap")}
        description={gt(
          'Subagents a thread runs at once. Past it, Claude\'s Agent tool and delegate_task are refused unless the prompt starts with "Budget justification:". Codex and other agents are told the cap. A thread can set its own from the count in its header. 0 allows none unjustified.',
        )}
        resetAction={reset("subagentCap", gt("Reset subagent cap to default"))}
        control={count("subagentCap", gt("Subagents at once"))}
      />
      <SettingsRow
        {...searchableSetting("agent-review-rounds")}
        description={gt(
          "Review bot rounds (Codex or another bot that reviews PRs) an agent fixes on a watched PR. Past it the watch ends and the agent lists what is left for you. Projects without a review bot are not affected. 0 is no cap.",
        )}
        resetAction={reset("reviewRoundCap", gt("Reset review round cap to default"))}
        control={count("reviewRoundCap", gt("Review rounds"))}
      />
      <SettingsRow
        {...searchableSetting("agent-checkpoints")}
        description={gt(
          "Minutes between progress reports on a long run, and how many changes in a row may leave the done-check no better before the agent stops and reports. 0 turns either off.",
        )}
        resetAction={
          reset("checkpointMinutes", gt("Reset progress report interval to default")) ??
          reset("stallLimit", gt("Reset stall limit to default"))
        }
        control={
          <div className="flex items-center gap-2">
            {count("checkpointMinutes", gt("Minutes between progress reports"))}
            {count("stallLimit", gt("Changes without improvement before stopping"))}
          </div>
        }
      />
    </SettingsSection>
  );
}

function CountInput(props: {
  readonly value: number;
  readonly maximum: number;
  readonly label: string;
  readonly disabled: boolean;
  readonly onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(props.value));
  const parsed = /^\d+$/u.test(draft.trim()) ? Number(draft.trim()) : null;
  const valid = parsed !== null && parsed <= props.maximum;
  const commit = () => {
    if (valid && parsed !== props.value) props.onSave(parsed);
    else if (!valid) setDraft(String(props.value));
  };
  return (
    <Input
      size="sm"
      className="w-16"
      inputMode="numeric"
      value={draft}
      disabled={props.disabled}
      aria-invalid={!valid}
      aria-label={props.label}
      title={props.label}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(String(props.value));
      }}
    />
  );
}
