import { forwardRef, type SelectHTMLAttributes } from 'react';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = '', ...props },
  ref,
) {
  return <select ref={ref} className={`ui-select ${className}`.trim()} {...props} />;
});
