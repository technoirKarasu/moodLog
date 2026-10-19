// 出典：デジタル庁デザインシステムウェブサイト https://design.digital.go.jp/dads/ およびデジタル庁GitHub https://github.com/digital-go-jp
// digital-go-jp/design-system-example-components-react v2.7.0（コミット 68b452e）の src/components/SupportText/SupportText.tsx をコピーしたもの。MIT License（同じディレクトリの LICENSE）
import type { ComponentProps } from 'react';

export type SupportTextProps = ComponentProps<'p'>;

export const SupportText = (props: SupportTextProps) => {
  const { children, className, ...rest } = props;

  return (
    <p className={`text-std-16N-170 text-solid-gray-600 ${className ?? ''}`} {...rest}>
      {children}
    </p>
  );
};
