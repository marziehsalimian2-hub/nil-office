import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  // Server actions default to a 1 MB request body; file uploads through actions (attachments, board follow-up evidence) are validated in
  // code at 25 MB (lib/upload-validation.ts MAX_UPLOAD_BYTES) — the transport limit must not be the smaller one.
  experimental: {
    serverActions: { bodySizeLimit: "26mb" },
  },
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