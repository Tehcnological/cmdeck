# Telegram

Connect a Telegram bot to follow and steer a thread from your phone: messages you send the bot
become turns on a thread you choose, the thread's notifications come back to you, and approval
requests arrive with **Approve** and **Deny** buttons.

CMDeck asks Telegram for new messages (long polling), so it needs no open port or public address.
While the bot is on, CMDeck contacts `api.telegram.org`, and your messages pass through Telegram's
servers. While it is off, CMDeck makes no request to Telegram.

## Connect a bot

1. In Telegram, message **@BotFather**, send `/newbot` and follow the prompts. Copy the token it
   gives you.
2. Find your own Telegram user id, for example by messaging **@userinfobot**.
3. In CMDeck, open **Settings → General → Telegram**, paste the token, enter your user id (several
   ids can be separated by commas) and choose **Connect**.

The token is kept in CMDeck's encrypted secret store; settings hold only a reference to it. A bot
with no allowed user id is refused. Anyone else who messages the bot gets no answer, and each such
message is recorded in the [audit log](./audit-log.md).

The bot then appears under **Settings → General → Notification channels**, where you can turn it
off (polling stops at once), turn it back on, or delete it (which also deletes the stored token).

## Choose the thread

Send the bot `/bind` and pick a thread from the list. From then on:

- text you send becomes a new turn on that thread, as if typed in the composer;
- when a run ends, you get its outcome and the agent's last reply;
- approval requests from that thread arrive with **Approve** and **Deny**.

`/unbind` stops forwarding, and **Unbind** under **Settings → General → Telegram** does the same.
Agents can list chats and bind one to a thread with the `messaging_chats` and `messaging_bind` MCP
tools, only for a thread whose modes are within their own.

Only private chats with the bot are served; the bot ignores groups.

## Approvals

Each approval button answers exactly the request it was sent for, once. If nobody answers within
five minutes, CMDeck denies the request: silence never approves. A request already answered in
CMDeck is left as it is. Your [approval policy](./approval-policy.md) still applies to approvals
given from Telegram.

Messages to Telegram follow the channel's notification rules, so quiet hours and rate limits apply
to them too. Text you send is passed to the agent with `@`, `$` and `/` mentions broken, so a
message cannot invoke a skill, attach a file or run a command by itself.
