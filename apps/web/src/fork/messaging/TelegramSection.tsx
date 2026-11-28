import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import {
  CMDECK_WS_METHODS,
  type EnvironmentId,
  type MessagingErrorReason,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { useSettingsScope } from "../../components/settings/SettingsScopeContext";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { channelList } from "../NotificationChannelsSection";
import { messagingErrorReason, splitAllowlist } from "./messaging.logic";

const chatList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:cmdeck:messaging-chats",
  tag: CMDECK_WS_METHODS.messagingChatsList,
  staleTimeMs: 0,
});

const connectBot = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:messaging-connect",
  tag: CMDECK_WS_METHODS.messagingConnect,
});

const unbindChat = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:cmdeck:messaging-unbind",
  tag: CMDECK_WS_METHODS.messagingChatsUnbind,
});

/**
 * Settings > General: connect a Telegram bot and see which thread each chat drives (WI-3.01).
 * Enabling, disabling and deleting a bot happen in Notification channels, like any channel.
 */
export function TelegramSection() {
  const { environment } = useSettingsScope();
  return environment === null ? null : (
    <Telegram key={environment.environmentId} environmentId={environment.environmentId} />
  );
}

function Telegram({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const chatsQuery = chatList({ environmentId, input: {} });
  const chats = AsyncResult.getOrElse(useAtomValue(chatsQuery), () => []);
  const refreshChats = useAtomRefresh(chatsQuery);
  const refreshChannels = useAtomRefresh(channelList({ environmentId, input: {} }));
  const canChange = useAtomValue(connectBot.permissionAtom(environmentId));
  const connect = useAtomCommand(connectBot, { reportFailure: false });
  const unbind = useAtomCommand(unbindChat);
  const [token, setToken] = useState("");
  const [allowed, setAllowed] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const problems: Record<MessagingErrorReason, string> = {
    empty_allowlist: gt(
      "Add at least one Telegram user id. Without one the bot would answer no one.",
    ),
    invalid_sender_id: gt("Telegram user ids are numbers, such as 123456789."),
    invalid_token: gt("That does not look like a bot token from BotFather."),
    chat_not_found: gt("That chat is gone. Send the bot a message to bring it back."),
    thread_not_found: gt("That thread is gone or archived."),
    unavailable: gt("Messaging is not available on this server."),
  };

  const submit = async () => {
    setBusy(true);
    const result = await connect({
      environmentId,
      input: {
        kind: "telegram",
        name: "Telegram",
        token: token.trim(),
        allowedUserIds: splitAllowlist(allowed),
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      const reason = messagingErrorReason(Cause.squash(result.cause));
      setMessage(reason === null ? gt("Could not connect the bot.") : problems[reason]);
      return;
    }
    setToken("");
    setAllowed("");
    setMessage(gt("Connected. Send your bot /bind in Telegram to choose its thread."));
    refreshChannels();
    refreshChats();
  };

  return (
    <SettingsSection id="telegram" title={gt("Telegram")}>
      <SettingsRow
        title={gt("Connect a bot")}
        description={gt(
          "Create a bot with @BotFather and paste its token. Only the Telegram user ids you list can use it. While a bot is on, CMDeck asks api.telegram.org for new messages; messages pass through Telegram.",
        )}
      >
        <div className="grid gap-2 pt-2">
          <Input
            type="password"
            autoComplete="off"
            value={token}
            disabled={!canChange}
            placeholder={gt("Bot token")}
            aria-label={gt("Bot token")}
            onChange={(event) => setToken(event.target.value)}
          />
          <Input
            value={allowed}
            disabled={!canChange}
            inputMode="numeric"
            placeholder={gt("Your Telegram user id, such as 123456789")}
            aria-label={gt("Allowed Telegram user ids")}
            onChange={(event) => setAllowed(event.target.value)}
          />
          {message === null ? null : <p className="text-xs text-muted-foreground">{message}</p>}
          <div>
            <Button
              size="sm"
              disabled={!canChange || busy || token.trim() === "" || allowed.trim() === ""}
              onClick={() => void submit()}
            >
              <T>Connect</T>
            </Button>
          </div>
        </div>
      </SettingsRow>
      {chats.map((chat) => (
        <SettingsRow
          key={`${chat.channelId}:${chat.chatId}`}
          title={chat.label}
          description={
            chat.threadTitle === null
              ? gt("Not bound. Send /bind to the bot to choose a thread.")
              : gt("Drives {thread}", { thread: chat.threadTitle })
          }
          control={
            chat.threadId === null ? null : (
              <Button
                size="xs"
                variant="outline"
                disabled={!canChange}
                onClick={() =>
                  void unbind({
                    environmentId,
                    input: { channelId: chat.channelId, chatId: chat.chatId },
                  }).then(refreshChats)
                }
              >
                <T>Unbind</T>
              </Button>
            )
          }
        />
      ))}
    </SettingsSection>
  );
}

export const settingsSection = { page: "general", order: 11, Component: TelegramSection } as const;
