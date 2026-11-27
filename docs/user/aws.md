# AWS

CMDeck has no AWS code of its own. Agents reach AWS through their own harness: Claude Code runs models on [Amazon Bedrock](./providers-claude.md#amazon-bedrock), and any harness can use AWS's MCP servers as tools. CMDeck never reads `~/.aws`, never calls AWS, and adds nothing AWS-related until you configure it.

IAM is what limits an agent, not prompts or approval modes. Set it up first.

## Give agents an inference-only role

Give the profile your agents use a role that can call models and nothing else. Claude Code needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:ListInferenceProfiles",
        "bedrock:GetInferenceProfile"
      ],
      "Resource": "*"
    }
  ]
}
```

Narrow `Resource` to the models and inference profiles you use. Claude Code's [Bedrock guide](https://code.claude.com/docs/en/amazon-bedrock) lists the AWS Marketplace permissions needed the first time a model is used, and the Bedrock Mantle endpoint also needs `bedrock-mantle:CreateInference`.

- Prefer an IAM Identity Center (SSO) profile or short-term Bedrock API keys over long-term access keys. You can refuse long-term Bedrock API keys with a `bedrock:bearerTokenType` condition.
- Use a dedicated AWS account for agents if you can.
- Give infrastructure tools (below) a **separate** profile, read-only by default, with a permissions boundary if it can write.

## Run Claude on Bedrock from other harnesses

- **Claude Code**: see [Amazon Bedrock](./providers-claude.md#amazon-bedrock).
- **OpenCode**: use its own `amazon-bedrock` provider with a profile, `AWS_PROFILE` or `AWS_BEARER_TOKEN_BEDROCK`; see [OpenCode providers](https://opencode.ai/docs/providers/). Put the variables on the OpenCode instance in **Settings → Providers**.
- **Codex**: Codex has its own Bedrock sign-in. Configure it in Codex; CMDeck shows the account type but has no Bedrock sign-in screen for it.

## Use AWS as agent tools

AWS's MCP servers let an agent query and change AWS with the permissions of the profile you give them. Add them to each harness's own MCP configuration (for Cursor, `~/.cursor/mcp.json`), then run **Restart agent session** so the next message picks them up. A server you don't configure never starts.

- **AWS MCP Server** calls any AWS API through one tool, runs sandboxed Python and searches AWS documentation. It runs in `us-east-1` and `eu-central-1`, connects through `mcp-proxy-for-aws`, and costs nothing beyond the resources you use. [Agent Toolkit for AWS](https://github.com/aws/agent-toolkit-for-aws) has ready-made configuration plus the `aws-core` and `aws-agents` skills for Claude Code, Codex and Cursor; its example policy keeps the server read-only even when your role can write.
- **Narrower [awslabs servers](https://github.com/awslabs/mcp)** for one job each:
  - `bedrock-kb-retrieval`: query and debug Bedrock knowledge bases.
  - `billing-cost-management` and `aws-pricing`: costs and estimates before you create anything.
  - `cloudwatch` and `cloudtrail`: logs, invocation logs and who did what.
  - `aws-iac`, `aws-serverless`, `ecs`, `sagemaker-ai`: deployments.
  - `aws-api`, `aws-knowledge`, `amazon-bedrock-agentcore`: general API calls and documentation.

  Servers that can write start read-only and need `--allow-write` or `ALLOW_WRITE`. The `iam`, `ccapi`, `kendra` and `qbusiness` servers are deprecated.

Keep your harness's approval mode on for tools that write. Agents can create resources that keep billing while idle, such as knowledge base indexes, OpenSearch Serverless collections, CloudWatch logs, SageMaker endpoints and EC2 instances.

## Track and cap spending

CMDeck's [usage view](./usage.md) estimates each thread's Bedrock cost from token counts. Your AWS bill is the real number.

- **Tags**: require tags such as `cmdeck:owner`, `cmdeck:thread` and `cmdeck:ttl` on anything agents create, enforced with an `aws:RequestTag` condition in their IAM policy, and activate them as cost allocation tags. For a per-instance Bedrock bill, create a tagged application inference profile for each CMDeck instance and use its ID as the model.
- **Budgets**: create a monthly cost budget with forecast alerts, and a Budgets action that applies a deny policy to the agent role. Budgets data refreshes up to three times a day, so alerts can lag 8 to 12 hours, and a budget is not a hard cap: charges can pass it before anything fires.
- **Cleanup**: AWS does not delete anything on its own. A [scheduled task](./workflows.md) can ask an agent to list resources whose `cmdeck:ttl` has passed and ask you before deleting them.
- Don't poll Cost Explorer: each API request costs $0.01.

## Run agents on EC2

An EC2 instance is an ordinary machine to CMDeck. Install CMDeck on it, join it to your tailnet, and add it as an environment over [Tailscale](./remote-access.md#tailscale-https). It bills for as long as it runs, so stop it when you are done.
