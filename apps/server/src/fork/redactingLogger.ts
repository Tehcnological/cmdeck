import { redactSecrets } from "@t3tools/shared/redaction";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import type * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as NodeUtil from "node:util";

// Formatting before redacting drops Node's colours on printed objects; ANSI codes inside a value
// would otherwise hide it from the patterns.
const redactingConsole = (console: Console.Console): Console.Console => ({
  ...console,
  log: (...args) => console.log(redactSecrets(NodeUtil.format(...args))),
  error: (...args) => console.error(redactSecrets(NodeUtil.format(...args))),
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
