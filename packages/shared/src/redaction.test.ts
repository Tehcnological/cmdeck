import { describe, expect, it } from "vite-plus/test";

import { makeSecretRedactionStream, redactSecrets } from "./redaction.ts";

// Fake credentials are assembled at runtime so secret scanners do not flag this file.
const fake = (...parts: ReadonlyArray<string>) => parts.join("");
const alnum = (length: number) => "aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0z".repeat(10).slice(0, length);

const github = fake("gh", "p_", alnum(36));
const githubFine = fake("github", "_pat_", alnum(22), "_", alnum(59));
const slack = fake("xo", "xb-", "1234567890-", alnum(24));
const slackHook = fake("https://hooks.slack.com/services/", "T0000/B0000/", alnum(24));
const awsKeyId = fake("AK", "IA", "ABCDEFGHIJ234567");
const awsSecret = alnum(40);
const anthropic = fake("sk-", "ant-api03-", alnum(40));
const openai = fake("sk-", "proj-", alnum(48));
const jwt = fake("ey", "JhbGciOiJIUzI1NiJ9", ".", "ey", "JzdWIiOiIxMjM0In0", ".", alnum(43));
const pem = fake(
  "-----BEGIN ",
  "OPENSSH PRIVATE KEY-----\n",
  alnum(64),
  "\n",
  alnum(20),
  "\n-----END ",
  "OPENSSH PRIVATE KEY-----",
);

describe("redactSecrets", () => {
  const positives: ReadonlyArray<readonly [rule: string, input: string, expected: string]> = [
    ["GitHub classic", `token ${github} here`, "token [redacted] here"],
    ["GitHub fine-grained", `use ${githubFine}`, "use [redacted]"],
    ["Slack token", `slack ${slack}`, "slack [redacted]"],
    ["Slack webhook", `post ${slackHook}`, "post https://hooks.slack.com/services/[redacted]"],
    ["AWS access key id", `key ${awsKeyId}.`, "key [redacted]."],
    [
      "AWS labelled secret",
      `aws_secret_access_key = ${awsSecret}`,
      "aws_secret_access_key = [redacted]",
    ],
    ["AWS JSON secret", `{"SecretAccessKey": "${awsSecret}"}`, '{"SecretAccessKey": "[redacted]"}'],
    ["Anthropic", `ANTHROPIC ${anthropic}`, "ANTHROPIC [redacted]"],
    ["OpenAI", `key=${openai}`, "key=[redacted]"],
    ["JWT", `jwt ${jwt} end`, "jwt [redacted] end"],
    ["private key block", `before\n${pem}\nafter`, "before\n[redacted]\nafter"],
    ["unterminated private key", `x ${pem.slice(0, 60)}`, "x [redacted]"],
    [
      "authorization header",
      "Authorization: Bearer abc.def-ghi",
      "Authorization: Bearer [redacted]",
    ],
    ["basic auth header", "authorization: Basic dXNlcjpwYXNz", "authorization: Basic [redacted]"],
    ["cookie header", "Cookie: session=abc123; theme=dark", "Cookie: [redacted]"],
    ["bare bearer", `sent bearer ${alnum(24)}`, "sent bearer [redacted]"],
    [
      "URL credentials",
      "clone https://alice:hunter2@git.example.com/app.git",
      "clone https://alice:[redacted]@git.example.com/app.git",
    ],
    [
      "URL password holding @",
      "postgres://u:p@ss@db.local/x",
      "postgres://u:[redacted]@db.local/x",
    ],
    ["labelled env value", "DB_PASSWORD=correct-horse", "DB_PASSWORD=[redacted]"],
    [
      "labelled quoted value with spaces",
      '{"apiKey": "my long key", "x": 1}',
      '{"apiKey": "[redacted]", "x": 1}',
    ],
    ["labelled query value", "?access_token=abc123&page=2", "?access_token=[redacted]&page=2"],
    ["labelled header", "x-api-key: abc123", "x-api-key: [redacted]"],
    ["inspected object", "{ clientSecret: 'shh-it-is' }", "{ clientSecret: '[redacted]' }"],
  ];

  it.each(positives)("redacts %s", (_rule, input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  const negatives: ReadonlyArray<readonly [rule: string, input: string]> = [
    ["git SHA", "commit 3f786850e387550fdab836ed7e6dc881de23001b"],
    ["UUID", "thread 123e4567-e89b-12d3-a456-426614174000"],
    ["base64 data URL", `img data:image/png;base64,iVBORw0KGgo${alnum(60)}=`],
    ["base64 blob", `payload ${alnum(80)}==`],
    ["token counts", "max_tokens: 4096, inputTokens=12, tokenCount=3"],
    ["secret word without value", "the secret is out, token expired"],
    ["null labelled value", "password: null, token=undefined, secret: true"],
    ["short labelled value", "token=ab"],
    ["labelled value already redacted", "{ token: '<redacted>' }"],
    ["working directory", "PWD=/home/alice/project"],
    ["URL with port", "https://example.com:8080/path"],
    ["URL with user only", "ssh://git@github.com/org/repo.git"],
    ["email", "mail ops@example.com"],
    ["sk word", "sk-learn and task-runner-for-everything-ok"],
    ["short GitHub-like", "ghp_short"],
    ["lowercase AWS-like", "akiaabcdefghij234567"],
    ["single JWT segment", "eyJhbGciOiJIUzI1NiJ9 alone"],
    ["bearer prose", "Bearer authentication is used"],
  ];

  it.each(negatives)("leaves %s alone", (_rule, input) => {
    expect(redactSecrets(input)).toBe(input);
  });

  it("is idempotent", () => {
    for (const [, input] of positives) {
      const once = redactSecrets(input);
      expect(redactSecrets(once)).toBe(once);
    }
  });

  it("redacts overlapping matches as one", () => {
    expect(redactSecrets(`GITHUB_TOKEN=${github}`)).toBe("GITHUB_TOKEN=[redacted]");
  });
});

describe("makeSecretRedactionStream", () => {
  const run = (chunks: ReadonlyArray<string>, maxHold?: number) => {
    const stream = makeSecretRedactionStream(maxHold);
    return chunks.map((chunk) => stream.push(chunk)).join("") + stream.end();
  };

  it("catches a token split across chunks", () => {
    const text = `log line\nuse ${github} now\nnext\n`;
    for (let at = 1; at < text.length; at++) {
      const output = run([text.slice(0, at), text.slice(at)]);
      expect(output).toBe(redactSecrets(text));
      expect(output).not.toContain(github.slice(4, 20));
    }
  });

  it("catches a label split from its value", () => {
    expect(run(["DB_PASS", "WORD=", "hunter2\n"])).toBe("DB_PASSWORD=[redacted]\n");
  });

  it("holds an unterminated private key until it ends", () => {
    const stream = makeSecretRedactionStream();
    const [head, tail] = [pem.slice(0, 50), pem.slice(50)];
    expect(stream.push(`ok\n${head}`)).toBe("ok\n");
    expect(stream.push(`${tail}\ndone\n`)).toBe("[redacted]\ndone\n");
    expect(stream.end()).toBe("");
  });

  it("emits complete lines as they arrive", () => {
    const stream = makeSecretRedactionStream();
    expect(stream.push("one\ntw")).toBe("one\n");
    expect(stream.push("o\n")).toBe("two\n");
  });

  it("bounds what it holds on a line that never ends", () => {
    const stream = makeSecretRedactionStream(2048);
    const emitted = stream.push("x".repeat(5000));
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.length + stream.end().length).toBe(5000);
  });
});
