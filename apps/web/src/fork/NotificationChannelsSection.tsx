import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcCommand,
} from "@t3tools/client-runtime/state/runtime";
import { CMDECK_WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useGT } from "gt-react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { connectionAtomRuntime } from "../connection/runtime";
import { useAtomCommand } from "../state/use-atom-command";

export const channelList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:notification-channels",
  tag: CMDECK_WS_METHODS.notificationChannelsList,
  staleTimeMs: 0,
});

const setChannelEnabled = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:notification-channel-set-enabled",
  tag: CMDECK_WS_METHODS.notificationChannelsSetEnabled,
});

const removeChannel = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:notification-channel-remove",
  tag: CMDECK_WS_METHODS.notificationChannelsRemove,
});

/** Settings > General: notification channels (WI-1.04). Hidden until a channel module adds one. */
export function NotificationChannelsSection() {
  const { environment } = useSettingsScope();
  return environment === null ? null : (
    <NotificationChannels
      key={environment.environmentId}
      environmentId={environment.environmentId}
    />
  );
}

function NotificationChannels({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const list = channelList({ environmentId, input: {} });
  const channels = AsyncResult.getOrElse(useAtomValue(list), () => []);
  const refresh = useAtomRefresh(list);
  const canChange = useAtomValue(setChannelEnabled.permissionAtom(environmentId));
  const setEnabled = useAtomCommand(setChannelEnabled);
  const remove = useAtomCommand(removeChannel);

  if (channels.length === 0) return null;

  return (
    <SettingsSection id="notification-channels" title={gt("Notification channels")}>
      {channels.map((channel) => (
        <SettingsRow
          key={channel.id}
          title={channel.name}
          description={
            channel.lastError === null
              ? channel.kind
              : gt("Delivery failing: {error}", { error: channel.lastError })
          }
          control={
            <div className="flex items-center gap-2">
              <Switch
                checked={channel.enabled}
                disabled={!canChange}
                aria-label={gt("Send to {name}", { name: channel.name })}
                onCheckedChange={(enabled) =>
                  void setEnabled({
                    environmentId,
                    input: { channelId: channel.id, enabled },
                  }).then(refresh)
                }
              />
              <Button
                size="xs"
                variant="outline"
                disabled={!canChange}
                onClick={() =>
                  void remove({ environmentId, input: { channelId: channel.id } }).then(refresh)
                }
              >
                {gt("Delete")}
              </Button>
            </div>
          }
        />
      ))}
    </SettingsSection>
  );
}

export const settingsSection = {
  page: "general",
  order: 10,
  Component: NotificationChannelsSection,
} as const;
