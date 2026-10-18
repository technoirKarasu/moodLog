import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";

// DADSの書体。ビルド時に取り込み、配信時に外部へ取りに行かない
const notoSansJp = Noto_Sans_JP({
  weight: ["400", "700"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "moodLog",
  description: "気分を記録し、週末にふりかえりのまとめを作るアプリ",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      {/*
        DADSは文字色と一緒に背景色も指定するよう求めている（ブラウザ設定で背景が変わってもコントラストを保つため）。
        左右のマージンは、DADSに具体値の定めがないため、8px基準でモバイル16px・デスクトップ32pxとする
      */}
      <body
        className={`${notoSansJp.className} bg-white text-solid-gray-800 text-std-16N-170 px-4 py-8 desktop:px-8`}
      >
        {children}
      </body>
    </html>
  );
}
