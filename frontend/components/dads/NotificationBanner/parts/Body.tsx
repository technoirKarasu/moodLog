// 出典：デジタル庁デザインシステムウェブサイト https://design.digital.go.jp/dads/ およびデジタル庁GitHub https://github.com/digital-go-jp
// digital-go-jp/design-system-example-components-react v2.7.0（コミット 68b452e）の src/components/NotificationBanner/parts/Body.tsx をコピーしたもの。MIT License（同じディレクトリの LICENSE）
import type { ComponentProps } from 'react';

type Props = ComponentProps<'div'>;

export const NotificationBannerBody = (props: Props) => {
  const { className, children, ...rest } = props;

  return (
    <div
      className={`
        col-start-1 -col-end-1 desktop:col-start-2 text-std-16N-170 text-solid-gray-800 grid gap-y-2
        ${className ?? ''}
      `}
      {...rest}
    >
      {children}
    </div>
  );
};
