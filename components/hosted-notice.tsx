/**
 * What a local-only page shows on a hosted deployment (FR-15.3).
 *
 * A server component: hosted-ness is a property of the process, decided before
 * render, so there is nothing to hydrate. The page keeps its URL — a link
 * someone saved locally still lands somewhere that explains itself, instead of
 * a 404 that looks like a regression.
 */
export function HostedNotice({ feature }: { feature: string }) {
  return (
    <div className="mx-auto max-w-lg space-y-3 p-10 text-center">
      <h1 className="text-lg font-medium">{feature} lives on your machine</h1>
      <p className="text-sm text-neutral-400">
        This deployment of IDEA runs in the cloud, where your repositories,
        event logs, and agents don&rsquo;t exist. Chat works here — {feature.toLowerCase()}{" "}
        needs IDEA running on a computer with your projects on it.
      </p>
      <p className="text-sm text-neutral-500">
        Run <code className="rounded bg-neutral-900 px-1.5 py-0.5">npx idea</code> locally to use
        everything.
      </p>
    </div>
  );
}
