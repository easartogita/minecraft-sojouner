# Self-hosted Git runbook — gitolite + least-privilege AI-dev workflow

A one-time setup for a self-hosted git forge that enforces the security boundary we
want: the disposable box running Claude Code can only *propose* changes (push
`claude/*` branches), never write `main`. You review and merge from your trusted
laptop. Enforcement is ref-level (gitolite), not discipline.

## Topology

Three roles — the forge and the Claude box should be **different machines** (the whole
point is that the Claude box is low-trust/disposable):

| Role | Box | Key | Can do |
|---|---|---|---|
| Forge | Pi #1 (trusted, low-maintenance) | — | holds authoritative repo + gitolite access control |
| Admin | your laptop (trusted) | `id_ed25519_gitadmin` | full access; reviews + merges `main` |
| Bot | Pi #2 / the Claude box (disposable) | `id_ed25519_claudebot` | push `claude/*` only; **cannot touch `main`** |

> A single compromised Claude box can, at worst, push a `claude/*` branch you then
> review before merging. It cannot write, delete, or rewrite `main`.

## 0. Keys (ed25519, not RSA)

Generate each key **on the machine that will hold its private half** — the bot's private
key must never leave the disposable box.

```bash
# On your laptop:
ssh-keygen -t ed25519 -C "you@laptop"  -f ~/.ssh/id_ed25519_gitadmin

# On the Claude/Pi box:
ssh-keygen -t ed25519 -C "claude-bot@pi" -f ~/.ssh/id_ed25519_claudebot
```

Collect the **public** halves. gitolite uses the *filename* as the identity, so name them:
`you.pub` and `claude-bot.pub`.

_(RSA fallback only if forced: `-t rsa -b 4096`. Modern OpenSSH rejects SHA-1 `ssh-rsa`.)_

## 1. Forge box — service user + gitolite

```bash
# On the forge Pi (Debian/RPi OS):
sudo adduser --disabled-password --home /home/git git
sudo -iu git

# Copy your admin pubkey over first, then bootstrap with it:
#   scp ~/.ssh/id_ed25519_gitadmin.pub  git@forge:/home/git/you.pub
git clone https://github.com/sitaramc/gitolite    # or: sudo apt install gitolite3
./gitolite/install -to ~/bin
export PATH=$PATH:~/bin
gitolite setup -pk you.pub          # bootstraps; installs the forced command in authorized_keys
```

gitolite now manages `~git/.ssh/authorized_keys` itself — **never hand-edit it**. Every key
it adds is pinned to `command="gitolite-shell …"`, so a key can only run git, never a shell.

## 2. Admin repo — add the bot key + access rules

From your **laptop** (add an SSH alias first, see §4):

```bash
git clone git@forge:gitolite-admin.git
cd gitolite-admin
cp /path/to/claude-bot.pub keydir/     # you.pub is already there from bootstrap
```

Edit `conf/gitolite.conf`:

```gitolite
repo gitolite-admin
    RW+                     = you

repo minecraft-sojourner
    RW+                     = you            # you: full control
    -   main master         = claude-bot     # deny first — bot can never write main/master
    RW  claude/             = claude-bot     # bot: create/push claude/* (no force, no delete)
    R                       = you claude-bot
```

Rules evaluate top-to-bottom, first match wins — the `-` deny sits above the `RW` so it
always takes effect. `RW` (no `+`) means the bot **cannot force-push, rewind, or delete**
even its own branches; you clean those up. Apply it:

```bash
git add -A && git commit -m "add minecraft-sojourner; least-priv claude-bot" && git push
```

The push *is* the deploy — gitolite reconfigures live.

## 3. Seed the repo

From wherever the project lives (e.g. this laptop):

```bash
git remote add forge git@forge:minecraft-sojourner.git
git push forge --all
git push forge --tags
```

## 4. SSH config

**Laptop** (`~/.ssh/config`):
```sshconfig
Host forge
    HostName 192.168.x.y            # forge Pi LAN IP
    User git
    IdentityFile ~/.ssh/id_ed25519_gitadmin
    IdentitiesOnly yes
```

**Claude/Pi box** (`~/.ssh/config`) — note the hardening:
```sshconfig
Host forge
    HostName 192.168.x.y
    User git
    IdentityFile ~/.ssh/id_ed25519_claudebot
    IdentitiesOnly yes
    ForwardAgent no                # never forward your agent to the disposable box
```

Then on the Pi: `git clone git@forge:minecraft-sojourner.git`.

## 5. SSH commit signing (recommended, new since your hiatus)

Sign with the *same* ed25519 key — no GPG. Do this on both laptop and Pi (each signs with
its own key, so you can tell human commits from bot commits):

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519_gitadmin.pub   # bot: its own .pub
git config --global commit.gpgsign true

# To verify signatures locally, list allowed signers:
mkdir -p ~/.config/git
printf 'you@laptop     ssh-ed25519 AAAA...yourkey\n'  >> ~/.config/git/allowed_signers
printf 'claude-bot@pi  ssh-ed25519 AAAA...botkey\n'   >> ~/.config/git/allowed_signers
git config --global gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers
```

Now `git log --show-signature` marks who signed each commit.

## 6. Your review → merge loop (the "PR", by hand)

The Claude box works on `claude/<topic>` and pushes it. You, on the laptop:

```bash
git fetch forge
git log --oneline main..forge/claude/<topic>      # what's new
git diff main...forge/claude/<topic>              # review the change (and check signatures)
git switch main
git merge --no-ff forge/claude/<topic>            # records the integration point
git push forge main                               # only your key can do this
```

That last push is the boundary: gitolite lets *you* write `main`; the bot key is denied. No
PR UI, but the same review gate.

## Hardening checklist

- [ ] Forge box `sshd`: `PasswordAuthentication no`, keys only.
- [ ] Bot private key lives **only** on the disposable Pi; never copied to the forge/laptop.
- [ ] No SSH agent forwarding to the Claude box (`ForwardAgent no`, above).
- [ ] Don't mount the laptop's filesystem onto the Claude box (would re-open the door).
- [ ] `git`-user shell restricted via gitolite's forced command (automatic — don't override).
- [ ] Reconcile the default branch: this repo is on `master` locally but bases PRs on `main`.

## If the manual loop wears thin

Adding a PR button later is a small step, not a rebuild: stand up **Forgejo** (lightweight,
runs on the same class of Pi) and point it at these repos. gitolite's enforcement model maps
onto Forgejo's protected branches + scoped tokens. But start here — it's the least admin.
