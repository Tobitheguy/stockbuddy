import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to this repo. Without it, Turbopack walks up the
    // tree, finds an unrelated package-lock.json in the user's home directory
    // and warns that it is inferring a root outside the git repository.
    root: path.join(__dirname),
  },
};

export default nextConfig;
