# SSH keys: RSA → ed25519 — reading list

Catch-up references for the key-type change (see also `self-hosted-git-runbook.md`, which
uses ed25519 throughout).

## The one nuance that matters

RSA itself is **not** broken or deprecated. What OpenSSH 8.8 (2021) disabled by default is
the old **`ssh-rsa` SHA-1 signature scheme** — SHA-1 is the broken part. RSA-3072/4096 with
SHA-256/512 still works. Prefer **ed25519** because it's smaller, faster, constant-time
(timing-attack resistant), simpler, and now the default — not because "RSA is dead."

## Quick explainers (why ed25519)

- Comparing SSH Keys: RSA, DSA, ECDSA, or EdDSA? — Teleport
  https://goteleport.com/blog/comparing-ssh-keys/
- SSH Keys in 2024: Why Ed25519 Replaced RSA as the Default — DEV
  https://dev.to/theisraelolaleye/ssh-keys-in-2024-why-ed25519-replaced-rsa-as-the-default-47aa
- EdDSA and Ed25519 — Practical Cryptography for Developers (Nakov)
  https://cryptobook.nakov.com/digital-signatures/eddsa-and-ed25519

## The OpenSSH SHA-1 story (what changed)

- OpenSSH 8.8 release notes (primary source; "future deprecation notice")
  https://www.openssh.org/txt/release-8.8
- RSA keys are not deprecated; the SHA-1 signature scheme is!
  https://ikarus.sg/rsa-is-not-dead/
- OpenSSH 8.3 released (ssh-rsa deprecation notice) — LWN
  https://lwn.net/Articles/821544/

## Primary / spec (authoritative)

- RFC 8709 — Ed25519 & Ed448 for SSH (the one for your keys)
  https://datatracker.ietf.org/doc/html/rfc8709
- RFC 8032 — EdDSA (the algorithm itself)
  https://www.rfc-editor.org/rfc/rfc8032.html
- EdDSA — Wikipedia
  https://en.wikipedia.org/wiki/EdDSA

## TL;DR command

```bash
ssh-keygen -t ed25519 -C "you@host"
```

_Fun fact: an ed25519 public key is ~68 chars; a 3072-bit RSA key is 3000+. The tech got
smaller, not bigger._
