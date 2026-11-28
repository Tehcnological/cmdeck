import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  BOT_INSTRUCTIONS_MAX_CHARS,
  type BotProfile,
  botNameProblem,
  type EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { T, useGT } from "gt-react";
import { useState } from "react";

import {
  SettingsRow,
  SettingsSection,
  useSettingsSearchTargetId,
} from "../components/settings/settingsLayout";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { useProjects } from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { botList, createBot, deleteBot, restoreBot, scheduleBot, updateBot, wakeBot } from "./bots";
import { type BotScheduleChoice, scheduleForChoice } from "./bots.logic";

/** The settings hash the "New bot" command opens, which starts the create form. */
export const NEW_BOT_TARGET = "new-bot";

const NO_BOTS: ReadonlyArray<BotProfile> = [];
const FORM_CLASS = "grid gap-2 px-3 py-3 sm:px-4";

/** Settings > Threads: persistent bots, each a pinned thread with instructions and private memory. */
export function BotsSection() {
  const { environment } = useSettingsScope();
  return environment === null ? null : (
    <Bots key={environment.environmentId} environmentId={environment.environmentId} />
  );
}

function Bots({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const list = botList({ environmentId, input: {} });
  const bots = AsyncResult.getOrElse(useAtomValue(list), () => NO_BOTS);
  const refresh = useAtomRefresh(list);
  const canChange = useAtomValue(createBot.permissionAtom(environmentId));
  const [creating, setCreating] = useState(false);
  // The palette's "New bot" lands here; keep the form open once the hash is cleared.
  if (useSettingsSearchTargetId() === NEW_BOT_TARGET && canChange && !creating) setCreating(true);

  return (
    <SettingsSection
      id="bots"
      title={gt("Bots", { $context: "settings section listing persistent agents" })}
      headerAction={
        canChange && !creating ? (
          <Button size="xs" variant="outline" onClick={() => setCreating(true)}>
            <T>New bot</T>
          </Button>
        ) : null
      }
    >
      {creating ? (
        <NewBotForm
          environmentId={environmentId}
          onClose={(created) => {
            setCreating(false);
            if (created) refresh();
          }}
        />
      ) : null}
      {bots.length === 0 && !creating ? (
        <SettingsRow
          title={gt("No bots yet")}
          description={gt(
            "A bot is a persistent agent: one pinned thread, standing instructions, private memory, and optional schedules that continue its thread.",
          )}
        />
      ) : null}
      {bots.map((bot) => (
        <BotRow
          key={bot.id}
          environmentId={environmentId}
          bot={bot}
          canChange={canChange}
          onChanged={refresh}
        />
      ))}
    </SettingsSection>
  );
}

function NewBotForm(props: {
  readonly environmentId: EnvironmentId;
  readonly onClose: (created: boolean) => void;
}) {
  const gt = useGT();
  const projects = useProjects().filter(
    (project) => project.environmentId === props.environmentId && project.isScratch !== true,
  );
  const create = useAtomCommand(createBot);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [projectId, setProjectId] = useState<string | null>(projects[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const nameProblem = name === "" ? null : (botNameProblem(name.trim()) ?? null);

  const submit = async () => {
    if (projectId === null) return;
    setBusy(true);
    const result = await create({
      environmentId: props.environmentId,
      input: { name: name.trim(), instructions, projectId: ProjectId.make(projectId) },
    });
    setBusy(false);
    if (result._tag === "Success") props.onClose(true);
  };

  return (
    <div id={NEW_BOT_TARGET} className={FORM_CLASS}>
      <Input
        value={name}
        placeholder={gt("Name, such as Release Watcher")}
        aria-label={gt("Bot name")}
        onChange={(event) => setName(event.target.value)}
      />
      {nameProblem === null ? null : (
        <p className="text-xs text-destructive-foreground">{nameProblem}</p>
      )}
      <Select
        value={projectId}
        onValueChange={(value) => setProjectId(typeof value === "string" ? value : null)}
      >
        <SelectTrigger size="sm" aria-label={gt("Project")}>
          <SelectValue>
            {(value: string | null) =>
              projects.find((project) => project.id === value)?.title ?? gt("Choose a project")
            }
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.title}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <InstructionsField value={instructions} onChange={setInstructions} />
      <p className="text-xs text-muted-foreground">
        <T>
          The bot uses the project's default model. Its thread is pinned in the sidebar, and its
          memory is visible only there.
        </T>
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || name.trim() === "" || nameProblem !== null || projectId === null}
          onClick={() => void submit()}
        >
          <T>Create bot</T>
        </Button>
        <Button size="sm" variant="outline" onClick={() => props.onClose(false)}>
          <T>Cancel</T>
        </Button>
      </div>
    </div>
  );
}

function InstructionsField(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const gt = useGT();
  return (
    <Textarea
      value={props.value}
      rows={4}
      maxLength={BOT_INSTRUCTIONS_MAX_CHARS}
      placeholder={gt("Instructions: what the bot is for and how it works")}
      aria-label={gt("Bot instructions")}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

type Panel = "edit" | "schedule" | null;

function BotRow(props: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotProfile;
  readonly canChange: boolean;
  readonly onChanged: () => void;
}) {
  const gt = useGT();
  const { bot, environmentId } = props;
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const wake = useAtomCommand(wakeBot);
  const remove = useAtomCommand(deleteBot);
  const restore = useAtomCommand(restoreBot);
  const deleted = bot.status === "deleted";

  const run = async (action: () => Promise<{ readonly _tag: string }>) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result._tag === "Success") props.onChanged();
  };

  const schedules = bot.scheduledTaskIds.length;
  const status = deleted
    ? gt("Deleted. Restoring brings back its thread, schedules and memory.")
    : schedules === 0
      ? gt("No schedule")
      : gt("{count, plural, one {# schedule} other {# schedules}}", { count: schedules });

  return (
    <SettingsRow
      title={bot.name}
      description={
        <>
          <span className="line-clamp-2 whitespace-pre-line">{bot.instructions}</span>
          <span className="block">{status}</span>
        </>
      }
      control={
        props.canChange ? (
          <div className="flex flex-wrap items-center gap-2">
            {deleted ? (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => restore({ environmentId, input: { id: bot.id } }))}
              >
                {gt("Restore", { $context: "verb, brings back a deleted bot" })}
              </Button>
            ) : (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy || schedules === 0}
                  onClick={() => void run(() => wake({ environmentId, input: { id: bot.id } }))}
                >
                  <T>Wake now</T>
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setPanel(panel === "schedule" ? null : "schedule")}
                >
                  <T>Add schedule</T>
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setPanel(panel === "edit" ? null : "edit")}
                >
                  {gt("Edit", { $context: "verb, edits a bot's name and instructions" })}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => remove({ environmentId, input: { id: bot.id } }))}
                >
                  {gt("Delete", { $context: "verb, deletes a bot" })}
                </Button>
              </>
            )}
          </div>
        ) : null
      }
    >
      {panel === "edit" && !deleted ? (
        <EditBotForm
          environmentId={environmentId}
          bot={bot}
          onClose={(changed) => {
            setPanel(null);
            if (changed) props.onChanged();
          }}
        />
      ) : null}
      {panel === "schedule" && !deleted ? (
        <ScheduleBotForm
          environmentId={environmentId}
          bot={bot}
          onClose={(changed) => {
            setPanel(null);
            if (changed) props.onChanged();
          }}
        />
      ) : null}
    </SettingsRow>
  );
}

function EditBotForm(props: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotProfile;
  readonly onClose: (changed: boolean) => void;
}) {
  const gt = useGT();
  const update = useAtomCommand(updateBot);
  const [name, setName] = useState(props.bot.name);
  const [instructions, setInstructions] = useState(props.bot.instructions);
  const [busy, setBusy] = useState(false);
  const nameProblem = botNameProblem(name.trim()) ?? null;

  const save = async () => {
    setBusy(true);
    const result = await update({
      environmentId: props.environmentId,
      input: { id: props.bot.id, name: name.trim(), instructions },
    });
    setBusy(false);
    if (result._tag === "Success") props.onClose(true);
  };

  return (
    <div className="grid gap-2 py-2">
      <Input
        value={name}
        aria-label={gt("Bot name")}
        onChange={(event) => setName(event.target.value)}
      />
      {nameProblem === null ? null : (
        <p className="text-xs text-destructive-foreground">{nameProblem}</p>
      )}
      <InstructionsField value={instructions} onChange={setInstructions} />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || nameProblem !== null} onClick={() => void save()}>
          <T>Save</T>
        </Button>
        <Button size="sm" variant="outline" onClick={() => props.onClose(false)}>
          <T>Cancel</T>
        </Button>
      </div>
    </div>
  );
}

function ScheduleBotForm(props: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotProfile;
  readonly onClose: (changed: boolean) => void;
}) {
  const gt = useGT();
  const schedule = useAtomCommand(scheduleBot);
  const [prompt, setPrompt] = useState("");
  const [choice, setChoice] = useState<BotScheduleChoice>("weekdays");
  const [cron, setCron] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = scheduleForChoice(choice, cron);
  const problem =
    "problem" in chosen ? (choice === "cron" && cron === "" ? "" : chosen.problem) : null;

  const labels: Record<BotScheduleChoice, string> = {
    hourly: gt("Every hour"),
    daily: gt("Every day at 09:00 (server time)"),
    weekdays: gt("Weekdays at 09:00 (server time)"),
    cron: gt("Custom cron expression"),
  };

  const add = async () => {
    if ("problem" in chosen) return;
    setBusy(true);
    const result = await schedule({
      environmentId: props.environmentId,
      input: { id: props.bot.id, prompt: prompt.trim(), schedule: chosen },
    });
    setBusy(false);
    if (result._tag === "Success") props.onClose(true);
  };

  return (
    <div className="grid gap-2 py-2">
      <Textarea
        value={prompt}
        rows={2}
        placeholder={gt("What the bot does on each run")}
        aria-label={gt("Prompt for each run")}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <Select
        value={choice}
        onValueChange={(value) => {
          if (value === "hourly" || value === "daily" || value === "weekdays" || value === "cron") {
            setChoice(value);
          }
        }}
      >
        <SelectTrigger size="sm" aria-label={gt("When it runs")}>
          <SelectValue>{(value: BotScheduleChoice) => labels[value]}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {(Object.keys(labels) as Array<BotScheduleChoice>).map((key) => (
            <SelectItem key={key} value={key}>
              {labels[key]}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {choice === "cron" ? (
        <Input
          value={cron}
          font="mono"
          placeholder="0 9 * * 1-5"
          aria-label={gt("Cron expression")}
          onChange={(event) => setCron(event.target.value)}
        />
      ) : null}
      {problem ? <p className="text-xs text-destructive-foreground">{problem}</p> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || prompt.trim() === "" || problem !== null}
          onClick={() => void add()}
        >
          <T>Add schedule</T>
        </Button>
        <Button size="sm" variant="outline" onClick={() => props.onClose(false)}>
          <T>Cancel</T>
        </Button>
      </div>
    </div>
  );
}
