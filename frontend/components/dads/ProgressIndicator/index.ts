// 出典：デジタル庁デザインシステムウェブサイト https://design.digital.go.jp/dads/ およびデジタル庁GitHub https://github.com/digital-go-jp
// digital-go-jp/design-system-example-components-react v2.7.0（コミット 68b452e）の src/components/ProgressIndicator/index.ts をコピーしたもの。MIT License（同じディレクトリの LICENSE）
export type {
  ProgressIndicatorLinearProps,
  ProgressIndicatorProps,
  ProgressIndicatorSpinnerProps,
  ProgressIndicatorStaticProps,
} from './ProgressIndicator';
export {
  ProgressIndicator,
  ProgressIndicatorLinear,
  ProgressIndicatorSpinner,
  ProgressIndicatorStatic,
} from './ProgressIndicator';
export type { ProgressIndicatorSize, ProgressIndicatorType } from './types';
// moodLog での変更: useProgressIndicatorAnnouncer（利用者の操作で始まる読み込み用）は使わないため、
// ファイルごとコピーせず、export も外した。元のファイルはlint（react-hooks/refs）にも通らない
