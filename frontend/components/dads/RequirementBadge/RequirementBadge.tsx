// 出典：デジタル庁デザインシステムウェブサイト https://design.digital.go.jp/dads/ およびデジタル庁GitHub https://github.com/digital-go-jp
// digital-go-jp/design-system-example-components-react v2.7.0（コミット 68b452e）の src/components/RequirementBadge/RequirementBadge.tsx をコピーしたもの。MIT License（同じディレクトリの LICENSE）
import type { ComponentProps } from 'react';

export type RequirementBadgeProps = ComponentProps<'span'> & {
  isOptional?: boolean;
};

export const RequirementBadge = (props: RequirementBadgeProps) => {
  const { children, className, isOptional, ...rest } = props;

  return (
    <span
      className={`
        ml-2 inline-block text-oln-16N-100 text-red-800
        data-[is-optional]:text-solid-gray-800
        ${className ?? ''}
      `}
      data-is-optional={isOptional || undefined}
      {...rest}
    >
      {children}
    </span>
  );
};
