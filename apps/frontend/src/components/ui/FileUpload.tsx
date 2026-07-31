import { useId, useState, type ChangeEvent } from 'react';

interface FileUploadProps {
  label: string;
  optionalLabel?: string;
  buttonLabel: string;
  emptyLabel: string;
  accept?: string;
  name?: string;
  disabled?: boolean;
  onFileChange(file: File | null): void;
}

export function FileUpload({
  label,
  optionalLabel,
  buttonLabel,
  emptyLabel,
  accept,
  name,
  disabled = false,
  onFileChange,
}: FileUploadProps) {
  const inputId = useId();
  const [fileName, setFileName] = useState('');

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setFileName(file?.name ?? '');
    onFileChange(file);
  }

  return (
    <div className="ui-field ui-file-upload">
      <span className="ui-field-label">
        {label} {optionalLabel && <span className="optional">{optionalLabel}</span>}
      </span>
      <div className="ui-file-upload-row">
        <label
          className={`button secondary ui-file-upload-trigger${disabled ? ' disabled' : ''}`}
          htmlFor={inputId}
          aria-disabled={disabled}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 16V4m0 0-4 4m4-4 4 4M5 15v4h14v-4" />
          </svg>
          {buttonLabel}
        </label>
        <span className="ui-file-name" aria-live="polite">
          {fileName || emptyLabel}
        </span>
      </div>
      <input
        id={inputId}
        className="ui-file-input"
        aria-label={label}
        name={name}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={handleChange}
      />
    </div>
  );
}
