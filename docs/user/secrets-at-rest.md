# Secrets at rest

CMDeck encrypts the credentials it keeps on disk: provider API keys you entered as values, sign-in keys, device pairing keys and similar. Each file in `<data folder>/userdata/secrets` is sealed with AES-256-GCM, so a copy of that folder, a stolen backup or a lost disk does not reveal them.

There is nothing to turn on. The first start of a build with this feature encrypts the existing files.

## Where the key lives

The key sits in `<data folder>/keys`, apart from the secrets (the data folder is `~/.cmdeck` unless you chose another one).

| Where CMDeck runs                                | How the key is kept                                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop app                                      | Wrapped by the OS keychain (Windows DPAPI, macOS Keychain, Linux libsecret or KWallet) in `secrets.key.safestorage`. The app hands the key to its server at start-up. |
| Linux server with systemd and a TPM2 chip        | Sealed to this machine's TPM with `systemd-creds` in `secrets.key.cred`. A copied disk or backup cannot unseal it.                                                    |
| Anywhere else (headless servers, SSH hosts, WSL) | A plain key file, `secrets.key`, readable only by your user, the same as the GitHub CLI, Docker or SOPS keep theirs.                                                  |

## What it does not protect against

Encryption at rest protects copies of your disk and backups. It does not stop a program running as your user account: such a program can ask the keychain for the desktop key, read `secrets.key`, or ask the running CMDeck server, just as it could read the plaintext files before. Agents you run in CMDeck run as your user too.

If you back up your whole data folder, leave `keys` out of that backup (or keep it somewhere else) so the backup stays encrypted. Without the key, the secrets cannot be recovered.

## The first start

CMDeck copies the plaintext files into `keys/secrets-backup-<date>` before it encrypts them, checks that every encrypted file reads back, and deletes the backup on the next start that opens every secret with the key.

## When CMDeck cannot open its secrets

CMDeck refuses to start, rather than lose or replace your secrets, and says what to do:

- **No key was found.** Restore `secrets.key` or `secrets.key.cred` into `keys` from a backup.
- **The key does not open any secret.** A different key is in `keys`. Restore the one that encrypted the secrets.
- **The key is kept by the desktop app.** A command such as `cmdeck auth` was run on a data folder the desktop app owns. Use the desktop app for that folder.
- **The TPM2 could not unseal the key.** The disk moved to another machine, or the TPM was reset.

If the key is truly lost, move `userdata/secrets` aside and start CMDeck again. It creates a new key and empty secrets: sign in to your providers again, re-enter any keys you typed into Settings, and pair your devices again.
