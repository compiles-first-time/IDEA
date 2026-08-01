import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";

import { redeemHandoff } from "@/lib/device-auth";
import { denialReason, isAllowed, parseAllowlist } from "@/lib/allowlist";

export const { handlers, auth, signIn, signOut } = NextAuth({
  pages: { signIn: "/login" },
  providers: [
    // `repo` scope so the same login can pull the user's repos (incl. private).
    GitHub({ authorization: { params: { scope: "read:user user:email repo" } } }),
    /**
     * Device-flow sign-in for local installs (S-52). The browser never holds a
     * GitHub token — it holds a one-time handoff code minted by
     * `lib/device-auth.ts` *after* the allowlist said yes. authorize() trades
     * it for the identity and Auth.js mints the same session the web OAuth
     * flow would have.
     */
    Credentials({
      id: "device",
      credentials: { handoff: {} },
      authorize(credentials) {
        const redeemed = redeemHandoff(String(credentials?.handoff ?? ""));
        if (!redeemed) return null;
        return { id: redeemed.login, login: redeemed.login, accessToken: redeemed.accessToken };
      },
    }),
  ],
  callbacks: {
    signIn({ account, profile }) {
      // Device flow: the allowlist was enforced before the handoff existed —
      // a non-null authorize() result *is* the decision.
      if (account?.provider === "device") return true;

      // Allow-listed GitHub logins (comma-separated env). Fail CLOSED: if
      // unset, nobody signs in this way — the device flow owns the
      // first-run claim (E-10.d); the web flow never does. Parsed fresh so a
      // claim that happened after boot is honored here too.
      const allowed = parseAllowlist(process.env.ALLOWED_LOGINS);
      const login = (profile as { login?: string } | undefined)?.login;
      if (isAllowed(login, allowed)) return true;
      // Still refused — but say who was refused. The browser may be signed into
      // a different GitHub account than the operator assumes, and "Access
      // Denied" alone gives them nothing to act on. A username is public, and
      // this goes to the local server log, never to the client.
      console.warn(`[auth] sign-in refused: ${denialReason(login, allowed)}`);
      return false;
    },
    jwt({ token, account, profile, user }) {
      if (account?.access_token) token.accessToken = account.access_token;
      if (profile && "login" in profile && profile.login) token.login = String(profile.login);
      // Device flow: identity comes from authorize()'s return, not a profile.
      const device = user as { login?: string; accessToken?: string } | undefined;
      if (account?.provider === "device" && device?.login) {
        token.login = device.login;
        token.accessToken = device.accessToken;
      }
      return token;
    },
    session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.login = token.login as string | undefined;
      return session;
    },
  },
});
