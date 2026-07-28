import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import { denialReason, isAllowed, parseAllowlist } from "@/lib/allowlist";

// Allow-listed GitHub logins (comma-separated env). Fail CLOSED: if unset, nobody
// can sign in — "not anyone can just go and use it".
const allowed = parseAllowlist(process.env.ALLOWED_LOGINS);

export const { handlers, auth, signIn, signOut } = NextAuth({
  pages: { signIn: "/login" },
  providers: [
    // `repo` scope so the same login can pull the user's repos (incl. private).
    GitHub({ authorization: { params: { scope: "read:user user:email repo" } } }),
  ],
  callbacks: {
    signIn({ profile }) {
      const login = (profile as { login?: string } | undefined)?.login;
      if (isAllowed(login, allowed)) return true;
      // Still refused — but say who was refused. The browser may be signed into
      // a different GitHub account than the operator assumes, and "Access
      // Denied" alone gives them nothing to act on. A username is public, and
      // this goes to the local server log, never to the client.
      console.warn(`[auth] sign-in refused: ${denialReason(login, allowed)}`);
      return false;
    },
    jwt({ token, account, profile }) {
      if (account?.access_token) token.accessToken = account.access_token;
      if (profile && "login" in profile && profile.login) token.login = String(profile.login);
      return token;
    },
    session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.login = token.login as string | undefined;
      return session;
    },
  },
});
