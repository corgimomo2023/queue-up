import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../src/components/ui/Button';
import { FileUpload } from '../src/components/ui/FileUpload';
import { Input } from '../src/components/ui/Input';
import { Select } from '../src/components/ui/Select';
import { Textarea } from '../src/components/ui/Textarea';

describe('light UI primitives', () => {
  it('renders a semantic button with stable visual variants', () => {
    render(<Button variant="primary">Save changes</Button>);

    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('button', 'primary', 'ui-button');
  });

  it('applies the shared light form-control contract without changing native semantics', () => {
    render(
      <>
        <Input aria-label="Event name" />
        <Textarea aria-label="Event description" />
        <Select aria-label="Event status">
          <option>Active</option>
        </Select>
      </>,
    );

    expect(screen.getByLabelText('Event name')).toHaveClass('ui-input');
    expect(screen.getByLabelText('Event description')).toHaveClass('ui-textarea');
    expect(screen.getByLabelText('Event status')).toHaveClass('ui-select');
    expect(screen.getByRole('option', { name: 'Active' })).toBeInTheDocument();
  });

  it('keeps the native file input accessible behind a styled upload control', () => {
    const onFileChange = vi.fn();
    render(
      <FileUpload
        label="Event logo"
        buttonLabel="Choose image"
        emptyLabel="No image selected"
        accept="image/png,image/jpeg,image/webp"
        onFileChange={onFileChange}
      />,
    );

    expect(screen.getByText('Choose image')).toHaveClass('ui-file-upload-trigger');
    expect(screen.getByText('No image selected')).toBeInTheDocument();

    const input = screen.getByLabelText('Event logo');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveClass('ui-file-input');

    const logo = new File(['png'], 'autumn.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [logo] } });

    expect(onFileChange).toHaveBeenCalledWith(logo);
    expect(screen.getByText('autumn.png')).toBeInTheDocument();
  });
});
