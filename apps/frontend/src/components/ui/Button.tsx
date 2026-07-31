import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'default' | 'small';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'default', type = 'button', className = '', ...props },
  ref,
) {
  const classes = ['button', variant, size === 'small' ? 'small' : '', 'ui-button', className]
    .filter(Boolean)
    .join(' ');

  return <button ref={ref} type={type} className={classes} {...props} />;
});
