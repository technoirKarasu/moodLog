import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // S3 + CloudFrontで配信するため、静的ファイルとして書き出す（frontend/out/）
  output: "export",
  // next dev がエージェント向けの AGENTS.md を作らないようにする。作業の指示は CLAUDE.md にまとめる（同じ内容を複数箇所に書かない）
  agentRules: false,
  // Tailwind CSS v4 をTurbopackで処理する。create-next-app@16.4.2 でTailwindを選んだときの既定の構成
  // （@tailwindcss/turbopack。PostCSSの設定ファイルは使わない）をそのまま使う
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
