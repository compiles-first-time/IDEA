import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * /observatory reads the vendored dashboard off disk at request time
   * (BR_05_Serve). Serverless bundlers trace `import`s, not `readFile` paths,
   * so without this the hosted function ships without the files and the route
   * 500s (BR_05_SE-02) — locally nothing changes.
   */
  outputFileTracingIncludes: {
    "/observatory": ["./vendor/**"],
  },
};

export default nextConfig;
