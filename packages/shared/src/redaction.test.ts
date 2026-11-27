import { describe, expect, it } from "vite-plus/test";

import { redactSecrets } from "./redaction.ts";

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

  it("redacts a quoted value up to its own closing quote, past escaped quotes", () => {
    const suffix = "long-secret-suffix";
    expect(redactSecrets(JSON.stringify({ password: `abc"${suffix}`, user: "ana" }))).toBe(
      '{"password":"[redacted]","user":"ana"}',
    );
    // Node's inspect quotes a string holding both quote characters with backticks.
    expect(redactSecrets(`{ password: \`it's "${suffix}"\` }`)).toBe("{ password: `[redacted]` }");
  });

  it("redacts quoted parts of a bare credential header", () => {
    expect(redactSecrets('Cookie: session="abcdef-secret-value"; theme=dark')).toBe(
      "Cookie: [redacted]",
    );
    expect(redactSecrets('Authorization: Digest username="ana", response="6629fae49393a053"')).toBe(
      "Authorization: Digest [redacted]",
    );
    expect(redactSecrets(JSON.stringify({ cookie: 'a="b"', next: 1 }))).toBe(
      '{"cookie":"[redacted]","next":1}',
    );
    const empty = '{"cookie":"","authorization":"","action":"deploy"}';
    expect(redactSecrets(empty)).toBe(empty);
  });

  it("exempts only whole unquoted literals, not secrets that start with one", () => {
    expect(redactSecrets("DB_PASSWORD=true-horse-battery-staple")).toBe("DB_PASSWORD=[redacted]");
    expect(redactSecrets('{"password":"true-secret-suffix"}')).toBe('{"password":"[redacted]"}');
    expect(redactSecrets('{"password":"false"}')).toBe('{"password":"[redacted]"}');
    expect(redactSecrets("token=null, secret: undefined")).toBe("token=null, secret: undefined");
  });

  // Quadratic scanning took about 5 s here, past the test timeout; linear takes milliseconds.
  it("scans long runs of scheme-like characters in linear time", () => {
    const run = "a-".repeat(100_000);
    expect(redactSecrets(run)).toBe(run);
  });
});
