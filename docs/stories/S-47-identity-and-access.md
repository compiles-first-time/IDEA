# S-47 — Identity and access beyond a GitHub allowlist

**Phase:** 3 · **Status:** Not started · **Traces to:** NFR-4, E-10.b
**Depends on:** nothing

## The questions

1. Someone without GitHub — how do they get in?
2. Can access be granted to a whole domain (`ideallab.ai`)?
3. Does a domain rule need 2FA, so an alias cannot mint access?
4. How do we invite someone outside the domain?
5. How does one person switch between accounts?

## Where we are

Auth is GitHub OAuth plus a comma-separated login allowlist, failing closed
(`lib/allowlist.ts`). It is correct and it is narrow: one identity provider, one
list, edited by hand in `.env.local`, with no self-service anything.

Account switching does not exist. Signing out and back in re-uses the browser's
GitHub session, so the second account needs a GitHub sign-out first — which is
how the `compiles-first-time` / `compiles-first-try` confusion happened.

## Recommendation

### Domain access: yes, but the domain must be *proved*, not claimed

A verified-email domain check is the right primitive. The trap is what "verified"
means:

- **GitHub email is not proof of domain control.** Anyone can add
  `anything@ideallab.ai` to a GitHub account; GitHub verifies the *address*, not
  that the domain vouches for the person. If the domain is a claim the user
  types, the rule is decorative.
- **Google Workspace / Microsoft Entra SSO is proof.** The identity provider is
  operated by the domain owner, so `hd=ideallab.ai` (Google) or a tenant id
  (Entra) means the org actually issued that account. This is the honest answer
  to "how do we let in people without GitHub" and "how do we grant a domain" —
  one mechanism answers both.

**2FA is the wrong lever for this.** It proves the person still controls the
account they already have; it says nothing about whether the domain issued it.
Requiring 2FA on top of a weak domain check hardens the wrong link. Enforce MFA
in the *identity provider*, where the org can mandate it centrally — and where a
user cannot opt out.

So: **add Google Workspace (and/or Entra) as a second provider, gate on the
verified hosted domain, and keep the GitHub allowlist for individuals.**

### Individuals outside the domain: named invitations, not a second door

An invite is an allowlist entry with provenance:

```yaml
- subject: someone@example.com
  provider: google          # which identity proved it
  invited_by: nick
  reason: contractor on ripple
  expires: 2026-10-01       # required, not optional
```

Two properties that matter more than convenience:

- **Expiry is mandatory.** Access that never lapses becomes access nobody
  remembers granting. A contractor who left in March should not still be able to
  read repos in December because no one held a removal meeting.
- **`invited_by` and `reason` are recorded.** Not for blame — so the list can be
  reviewed later by someone who was not in the room. An allowlist with no
  provenance cannot be audited, only trusted.

Fail-closed still governs: unknown subject, expired entry, or unverified domain
all deny.

### Account switching

Sign-out must clear the *provider* session, not just IDEA's, or the next sign-in
silently reuses the same account. Offer "switch account" that forces the account
chooser (`prompt=select_account` on Google, `login` on GitHub), and show the
signed-in identity in the nav — which it now does.

## What must not happen

- **No password auth.** IDEA runs on a machine with shell access and repo write
  (`09-agent-authority`). It has no business storing credentials, and a local app
  is the worst place to build a login system.
- **No "domain in the email string" check** without a verified issuer. It reads
  as security and is a text comparison.
- **No widening by default.** Adding a provider must not implicitly admit anyone;
  each provider carries its own explicit rule.

## Done when

- A Workspace user at the allowed domain signs in with no GitHub account.
- A user whose GitHub email merely *ends in* the domain is refused, and the log
  says why.
- An invited outsider signs in until their expiry, then is refused.
- Switching accounts does not require signing out of the provider by hand.
- Every refusal names what was refused (`lib/allowlist.ts` already does this).
