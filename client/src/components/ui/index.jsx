import { forwardRef } from 'react';

const cx = (...values) => values.filter(Boolean).join(' ');

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cx('btn', `btn--${variant}`, `btn--${size}`, className)} {...rest}>
      {children}
    </button>
  );
});

/**
 * Icon-only control. `label` is mandatory: it becomes both the accessible name
 * and the tooltip, so no icon button can ship without one.
 */
export const IconButton = forwardRef(function IconButton(
  { icon, label, active = false, tone = 'default', size = 'md', className, badge, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx('icon-btn', `icon-btn--${size}`, active && 'is-active', tone !== 'default' && `icon-btn--${tone}`, className)}
      aria-label={label}
      aria-pressed={typeof rest['aria-pressed'] === 'boolean' ? rest['aria-pressed'] : active || undefined}
      title={label}
      {...rest}
    >
      <span className="icon-btn__glyph">{icon}</span>
      {badge ? <span className="icon-btn__badge" aria-hidden="true">{badge}</span> : null}
    </button>
  );
});

export const Field = ({ label, hint, error, htmlFor, children, className }) => (
  <div className={cx('field', className)}>
    {label ? (
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
    ) : null}
    {children}
    {error ? (
      <p className="field__error" role="alert">
        {error}
      </p>
    ) : hint ? (
      <p className="field__hint">{hint}</p>
    ) : null}
  </div>
);

export const TextInput = forwardRef(function TextInput({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx('input', invalid && 'input--invalid', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx('input', 'select', className)} {...rest}>
      {children}
    </select>
  );
});

export const Spinner = ({ label = 'Loading' }) => (
  <span className="spinner" role="status" aria-live="polite">
    <span className="spinner__ring" aria-hidden="true" />
    <span className="visually-hidden">{label}</span>
  </span>
);

export const Badge = ({ tone = 'neutral', children, ...rest }) => (
  <span className={cx('badge', `badge--${tone}`)} {...rest}>
    {children}
  </span>
);

/**
 * Accessible modal: focus is moved in on open, Escape closes, and the page
 * behind it is inert to pointer events.
 */
export const Modal = ({ open, onClose, title, description, children, footer, labelledBy = 'aurex-modal-title' }) => {
  if (!open) return null;
  return (
    <div className="modal" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className="modal__panel" role="dialog" aria-modal="true" aria-labelledby={labelledBy} onKeyDown={(event) => event.key === 'Escape' && onClose?.()}>
        <div className="modal__head">
          <h2 className="modal__title" id={labelledBy}>
            {title}
          </h2>
          {onClose ? (
            <IconButton icon={<span aria-hidden="true">×</span>} label="Close dialog" size="sm" onClick={onClose} />
          ) : null}
        </div>
        {description ? <p className="modal__description">{description}</p> : null}
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
};

export const Callout = ({ tone = 'info', title, children, icon }) => (
  <div className={cx('callout', `callout--${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
    {icon ? <span className="callout__icon">{icon}</span> : null}
    <div className="callout__body">
      {title ? <p className="callout__title">{title}</p> : null}
      {children ? <div className="callout__text">{children}</div> : null}
    </div>
  </div>
);

export const Switch = ({ checked, onChange, label, description, id, disabled }) => (
  <div className="switch">
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      className={cx('switch__control', checked && 'is-on')}
      onClick={() => onChange?.(!checked)}
      disabled={disabled}
    >
      <span className="switch__thumb" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </button>
    <div className="switch__text">
      <span className="switch__label">{label}</span>
      {description ? <span className="switch__description">{description}</span> : null}
    </div>
  </div>
);

export { cx };
