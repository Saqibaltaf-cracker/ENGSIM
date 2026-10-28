import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, Info } from 'lucide-react';
export function Field({
  label,
  value,
  onChange,
  unit = '',
  min = -Infinity,
  max = Infinity,
  step = 1,
  hint = '',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  const id = useId(),
    [text, setText] = useState(String(Number(value.toFixed(3)))),
    [error, setError] = useState('');
  useEffect(() => {
    setText(String(Number(value.toFixed(3))));
    setError('');
  }, [value]);
  function commit() {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n) || n < min || n > max) {
      setError(
        `Enter ${Number.isFinite(min) ? min : 'a number'} to ${Number.isFinite(max) ? max : 'a finite value'}.`,
      );
      return;
    }
    setError('');
    onChange(n);
  }
  return (
    <div className={'field ' + (error ? 'invalid' : '')}>
      <label htmlFor={id}>
        {label}
        {hint && (
          <span className="field-help" title={hint}>
            <Info size={11} />
          </span>
        )}
      </label>
      <div className="input-unit">
        <input
          id={id}
          aria-invalid={!!error}
          title={hint}
          type="number"
          step={step}
          min={min}
          max={max}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span>{unit}</span>
      </div>
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {hint && (
          <span title={hint}>
            <Info size={11} />
          </span>
        )}
      </label>
      <div className="select-wrap">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={12} />
      </div>
    </div>
  );
}
export function Range({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  display,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  display?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="range-field">
      <div>
        <label title={hint} htmlFor={id}>
          {label}
        </label>
        <output htmlFor={id}>{display ?? value}</output>
      </div>
      <input
        id={id}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
      />
    </div>
  );
}
export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (b: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="toggle-row" title={hint}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-switch" />
    </label>
  );
}
export function Section({
  title,
  children,
  open = false,
  badge,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
  badge?: string;
}) {
  return (
    <details className="config-section" open={open}>
      <summary>
        {title}
        {badge && <span className="tiny-badge">{badge}</span>}
        <ChevronDown size={13} />
      </summary>
      <div className="section-content">{children}</div>
    </details>
  );
}
