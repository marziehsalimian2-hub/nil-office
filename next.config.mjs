import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  webpack(config) {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/node_modules/**", "C:/pagefile.sys", "C:/swapfile.sys", "C:/hiberfil.sys", "C:/DumpStack.log.tmp"],
      poll: false,
    };
    return config;
  },
};

export default nextConfig;