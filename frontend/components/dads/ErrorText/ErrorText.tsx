// 出典：デジタル庁デザインシステムウェブサイト https://design.digital.go.jp/dads/ およびデジタル庁GitHub https://github.com/digital-go-jp
// digital-go-jp/design-system-example-components-react v2.7.0（コミット 68b452e）の src/components/ErrorText/ErrorText.tsx をコピーしたもの。MIT License（同じディレクトリの LICENSE）
import type { ComponentProps } from 'react';

export type ErrorTextProps = ComponentProps<'p'>;

export const ErrorText = (props: ErrorTextProps) => {
  const { children, className, ...rest } = props;

  return (
    <p className={`text-dns-16N-130 text-error-1 ${className ?? ''}`} {...rest}>
      {children}
    </p>
  );
};
