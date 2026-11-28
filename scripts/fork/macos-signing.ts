import { sign, type SignOptions } from "@electron/osx-sign";

export function hasMacDeveloperIdCredentials(env: Readonly<Record<string, string | undefined>>) {
  return [
    env.CSC_LINK,
    env.CSC_KEY_PASSWORD,
    env.APPLE_ID,
    env.APPLE_TEAM_ID,
    env.APPLE_APP_SPECIFIC_PASSWORD,
  ].every((value) => Boolean(value?.trim()));
}

export default async function signAdHoc(options: SignOptions): Promise<void> {
  await sign({ ...options, identity: "-", batchCodesignCalls: true });
}
