import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  LESSON_CHOICES,
  type LessonChoice,
  lessonChoice,
  lessonProjects,
  lessonsModelNote,
} from "./lessons.logic";

const decisionsStatus = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:decisions-status",
  tag: CMDECK_WS_METHODS.decisionsStatus,
  staleTimeMs: 0,
});

const setLessonsProject = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:lessons-set-project",
  tag: CMDECK_WS_METHODS.lessonsSetProject,
});

/** Settings > Memory (WI-2.07): which projects' chats the decision model may learn lessons from. */
export function LessonsSection({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const query = useEnvironmentQuery(decisionsStatus({ environmentId, input: {} }));
  const canWrite = useAtomValue(setLessonsProject.permissionAtom(environmentId));
  const setProject = useAtomCommand(setLessonsProject);
  const projects = lessonProjects(useProjects(), environmentId);
  const note = lessonsModelNote(query.data);
  const labels = {
    off: gt("Off", { $context: "lessons for a project" }),
    local: gt("Local model only"),
    remote: gt("Any model"),
  } satisfies Record<LessonChoice, string>;

  return (
    <SettingsSection id="memory-lessons" title={gt("Lessons", { $context: "settings section" })}>
      <SettingsRow
        title={gt("Learn from chats")}
        description={
          note === "none"
            ? gt(
                "No decision model is set, so no chat is read. Name one as cmdeck.decisionModel in settings.json.",
              )
            : note === "remote"
              ? gt(
                  "The decision model is not on this machine or network, so projects set to local only are not read.",
                )
              : gt(
                  "Now and then the decision model reads what you and the agent wrote in a project you turn on here, never tool output, and proposes what you taught as facts below. Nothing is used until you accept it.",
                )
        }
      />
      {projects.map((project) => {
        const choice = lessonChoice(query.data, project.id);
        return (
          <SettingsRow
            key={project.id}
            title={project.title}
            control={
              <Select
                value={choice}
                disabled={!canWrite || query.data === null}
                onValueChange={(value) => {
                  const next = LESSON_CHOICES.find((option) => option === value);
                  if (next === undefined || next === choice) return;
                  void setProject({
                    environmentId,
                    input: { projectId: project.id, source: next === "off" ? null : next },
                  }).then(query.refresh);
                }}
              >
                <SelectTrigger
                  aria-label={gt("Lessons for {project}", { project: project.title })}
                  className="min-w-40"
                  size="xs"
                >
                  <SelectValue>{labels[choice]}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {LESSON_CHOICES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {labels[option]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        );
      })}
    </SettingsSection>
  );
}
