import * as Schema from "effect/Schema";

/** A configured delivery target. Credentials are secret references, never stored values. */
export const NotificationChannel = Schema.Struct({
  id: Schema.String,
  /** Which channel module delivers it; open-ended so messaging modules add kinds later. */
  kind: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
  createdAt: Schema.Number,
  /** The newest undelivered message's last error, redacted, while one is retrying or gave up. */
  lastError: Schema.NullOr(Schema.String),
});
export type NotificationChannel = typeof NotificationChannel.Type;

export const NotificationChannelIdInput = Schema.Struct({ channelId: Schema.String });
export type NotificationChannelIdInput = typeof NotificationChannelIdInput.Type;

export const NotificationChannelSetEnabledInput = Schema.Struct({
  channelId: Schema.String,
  enabled: Schema.Boolean,
});
export type NotificationChannelSetEnabledInput = typeof NotificationChannelSetEnabledInput.Type;

/** A fork-only event worth telling the person at the open app about. Text is redacted. */
export const ForkAlert = Schema.Struct({
  id: Schema.String,
  occurredAt: Schema.Number,
  title: Schema.String,
  body: Schema.String,
});
export type ForkAlert = typeof ForkAlert.Type;

export class NotificationChannelError extends Schema.TaggedError<NotificationChannelError>()(
  "NotificationChannelError",
  { cause: Schema.optionalKey(Schema.Defect()) },
) {
  override get message(): string {
    return "Could not change the notification channels.";
  }
}
