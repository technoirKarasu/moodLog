import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // S3 + CloudFrontで配信するため、静的ファイルとして書き出す（frontend/out/）
  output: "export",
  // next dev がエージェント向けの AGENTS.md を作らないようにする。作業の指示は CLAUDE.md にまとめる（同じ内容を複数箇所に書かない）
  agentRules: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
