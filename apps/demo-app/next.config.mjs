/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship raw TS (main → src/index.ts). Next needs to
  // transpile them on the fly during dev/build.
  transpilePackages: ["@marmar9615-cloud/agentbridge-core", "@marmar9615-cloud/agentbridge-sdk"],
  // The /.well-known/agentbridge.json route is implemented as a route
  // handler. Folder names beginning with `.` confuse Next's app-dir
  // resolver, so we rewrite to a normal segment.
  async rewrites() {
    return [
      {
        source: "/.well-known/agentbridge.json",
        destination: "/api/well-known/agentbridge",
      },
    ];
  },
};

export default nextConfig;
