// 背景（key-50）の上に置く白い面。入力欄や一覧など、まとまりごとに置く（Issue #73）。
//
// - 赤い文字（エラー、必須）は背景 key-50 の上では文字の基準を満たさないため、赤い文字が出うるものはこの中に置く
// - 背景との差は 1.1:1 で、縁は見分けにくい。区切りは中の見出しで伝わるため、縁は装飾として扱う
// - 角丸は DADS の「ラージ（32）」を、横長の要素向けに補正した 16

import type { ReactNode } from "react";

export function Panel({ children }: { children: ReactNode }) {
  return <div className="rounded-16 bg-white p-4 desktop:p-6">{children}</div>;
}
