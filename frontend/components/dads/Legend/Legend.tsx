// 出典：デジタル庁デザインシステムウェブサイト https://design.digital.go.jp/dads/ およびデジタル庁GitHub https://github.com/digital-go-jp
// digital-go-jp/design-system-example-components-react v2.7.0（コミット 68b452e）の src/components/Legend/Legend.tsx をコピーしたもの。MIT License（同じディレクトリの LICENSE）
import type { ComponentProps } from 'react';

export type LegendSize = 'lg' | 'md' | 'sm';

export type LegendProps = ComponentProps<'legend'> & {
  size?: LegendSize;
};

export const Legend = (props: LegendProps) => {
  const { children, className, size = 'md', ...rest } = props;

  return (
    <legend
      className={`
        flex w-fit items-center gap-2 text-solid-gray-800
        data-[size=sm]:text-std-16B-170 data-[size=md]:text-std-17B-170 data-[size=lg]:text-std-18B-160
        ${className ?? ''}
      `}
      data-size={size}
      {...rest}
    >
      {children}
    </legend>
  );
};
