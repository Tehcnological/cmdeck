import { redactSecrets } from "@t3tools/shared/redaction";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import type * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as NodeUtil from "node:util";

// Matching runs on plain one-line text with later string arguments quoted: ANSI colours, inspect's
// `'…' +` line splits and `log(label, value)` annotations would otherwise cut a value short.
// A line with nothing to redact keeps its pretty form.
export const redactLine = (args: ReadonlyArray<unknown>): string => {
  const line = NodeUtil.format(...args);
  const plain = NodeUtil.stripVTControlCharacters(
    NodeUtil.formatWithOptions(
      { breakLength: Infinity },
      ...args.map((arg, index) =>
        index > 0 && typeof arg === "string" ? JSON.stringify(arg) : arg,
      ),
    ),
  );
  const redacted = redactSecrets(plain);
  return redacted === plain ? line : redacted;
};

const redactingConsole = (console: Console.Console): Console.Console => ({
  ...console,
  log: (...args) => console.log(redactLine(args)),
  error: (...args) => console.error(redactLine(args)),
});

/**
 * Hands `logger` a console that redacts secrets from every line it prints, so the message, its
 * fields, annotations and cause are all covered whatever shape they take.
 */
export const redactingSecrets = <Output>(logger: Logger.Logger<unknown, Output>) =>
  Logger.make<unknown, Output>((options) => {
    const context = Context.add(
      options.fiber.context,
      Console.Console,
      redactingConsole(options.fiber.getRef(Console.Console)),
    );
    const fiber: Fiber.Fiber<unknown, unknown> = Object.create(options.fiber, {
      getRef: { value: <A>(ref: Context.Reference<A>): A => Context.get(context, ref) },
    });
    return logger.log({ ...options, fiber });
  });
