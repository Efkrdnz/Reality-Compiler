import { useEffect, useRef, useState, type ReactNode } from 'react';
import { compile } from '../../sim/rules/expr';

export function Toggle({ value, onChange, title }: { value: boolean; onChange: (v: boolean) => void; title?: string }) {
  return <button type="button" title={title} className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)} aria-pressed={value} />;
}

/** Number input that commits on blur/Enter and accepts only finite numbers. */
export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  className = '',
  digits = 2,
  title,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
  digits?: number;
  title?: string;
}) {
  const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** digits) / 10 ** digits) : '0');
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);
  const commit = (t: string) => {
    const v = Number(t);
    if (t.trim() === '' || !Number.isFinite(v)) {
      setBad(true);
      return;
    }
    setBad(false);
    let c = v;
    if (min !== undefined) c = Math.max(min, c);
    if (max !== undefined) c = Math.min(max, c);
    onChange(c);
    setText(fmt(c));
  };
  return (
    <input
      className={`input mono ${bad ? 'error' : ''} ${className}`}
      value={text}
      title={title ?? (bad ? 'Enter a number' : undefined)}
      inputMode="decimal"
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setText(e.target.value);
        setBad(e.target.value.trim() !== '' && !Number.isFinite(Number(e.target.value)));
      }}
      onBlur={(e) => {
        setFocused(false);
        commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(fmt(value));
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const cur = Number(text);
          if (Number.isFinite(cur)) {
            const k = e.shiftKey ? 10 : 1;
            commit(String(cur + (e.key === 'ArrowUp' ? step : -step) * k));
          }
        }
      }}
    />
  );
}

/** Slider + number combo. */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  digits = 2,
  onStart,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  digits?: number;
  onStart?: () => void;
}) {
  const p = ((Math.max(min, Math.min(max, value)) - min) / (max - min)) * 100;
  return (
    <div className="flex grow" style={{ gap: 8 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.max(min, Math.min(max, value))}
        style={{ ['--p' as string]: `${p}%`, flex: 1 }}
        onPointerDown={onStart}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <NumberInput value={value} onChange={onChange} step={step} digits={digits} className="w64" />
    </div>
  );
}

/** Expression input with live compile feedback. */
export function ExprInput({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const c = text.trim() === '' ? null : compile(text);
  const err = c && !c.ok ? c.error : text.trim() === '' && !placeholder ? 'empty expression' : '';
  return (
    <input
      className={`input mono ${err ? 'error' : ''} ${className}`}
      value={text}
      placeholder={placeholder}
      title={err || 'Expression — e.g. self.mass * 2, rand(0, 100), $score + 1'}
      spellCheck={false}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setText(e.target.value);
        const cc = compile(e.target.value);
        if (cc.ok) onChange(e.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        if (text !== value) {
          // commit even invalid text so the validator can explain it
          onChange(text);
        }
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  className = '',
  list,
  pattern,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  list?: string;
  pattern?: RegExp;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const bad = pattern && text !== '' && !pattern.test(text);
  return (
    <input
      className={`input ${bad ? 'error' : ''} ${className}`}
      value={text}
      list={list}
      placeholder={placeholder}
      spellCheck={false}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (text !== value) onChange(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">
        <span>{title}</span>
        {right && <span className="right">{right}</span>}
      </div>
      {children}
    </div>
  );
}

export function Row({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="row" title={title}>
      <label>{label}</label>
      <div className="grow flex">{children}</div>
    </div>
  );
}

export function Sparkline({ data, color, height = 34, fill = true }: { data: number[]; color: string; height?: number; fill?: boolean }) {
  const w = 200;
  if (data.length < 2) return <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} />;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of data) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(height - 3 - ((v - lo) / (hi - lo)) * (height - 6)).toFixed(1)}`);
  const id = `g${color.replace('#', '')}`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <polygon points={`0,${height} ${pts.join(' ')} ${w},${height}`} fill={`url(#${id})`} />}
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
