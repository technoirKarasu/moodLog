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
// moodLog での変更: useProgressIndicatorAnnouncer は使わないため、ファイルごとコピーせず、export も外した。
// 公式の説明では、このフックは利用者の操作（ボタンを押すなど）で始まる読み込みに使い、
// 画面遷移など暗黙的な操作で始まる読み込みでは使わない（https://github.com/digital-go-jp/design-system-example-components-react/blob/68b452e/src/components/ProgressIndicator/ProgressIndicator.stories.tsx#L296）。
// moodLog のページはページを開いたときに自動で読み込むため、後者にあたる
