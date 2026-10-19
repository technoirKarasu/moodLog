// 出典：デジタル庁デザインシステムウェブサイト https://design.digital.go.jp/dads/ およびデジタル庁GitHub https://github.com/digital-go-jp
// digital-go-jp/design-system-example-components-react v2.7.0（コミット 68b452e）の src/components/Slot/Slot.tsx をコピーしたもの。MIT License（同じディレクトリの LICENSE）
import { Children, cloneElement, type HTMLAttributes, isValidElement, type ReactNode } from 'react';

type SlotProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
};

export const Slot = (props: SlotProps) => {
  const { children, ...rest } = props;

  // https://react.dev/reference/react/isValidElement
  // https://react.dev/reference/react/cloneElement
  // moodLog での変更: React 19 の型では isValidElement の props が unknown になり、型チェックに通らないため、型引数を付けた
  if (isValidElement<HTMLAttributes<HTMLElement>>(children)) {
    return cloneElement(children, {
      ...rest,
      ...children.props,
      className: `${rest.className ?? ''} ${children.props.className ?? ''}`,
    });
  }

  if (Children.count(children) > 1) {
    Children.only(null);
  }

  return null;
};
