import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ExplicitTextFormat } from './draftFormat';
import { Icon } from './Icon';
import { useI18n } from './i18n';

const formats: { value: ExplicitTextFormat; label: string }[] = [
  { value: 'plain', label: 'Plain text' },
  { value: 'markdown', label: 'Markdown list' },
  { value: 'ascii', label: 'ASCII tree' },
  { value: 'unicode', label: 'Unicode tree' },
];

interface FormatSwitchProps {
  value: ExplicitTextFormat;
  active: boolean;
  disabled: boolean;
  onActivate: () => void;
  onSelect: (format: ExplicitTextFormat) => void;
}

/** The label opens the editor; only the separate menu button changes its format. */
export function FormatSwitch({ value, active, disabled, onActivate, onSelect }: FormatSwitchProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const initialFocus = useRef(0);
  const menuId = useId();
  const selected = formats.findIndex(format => format.value === value);

  useEffect(() => {
    if (!open) return;
    items.current[initialFocus.current]?.focus();
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  function showMenu(index = selected) { initialFocus.current = index; setOpen(true); }
  function closeMenu() { setOpen(false); trigger.current?.focus(); }
  function menuKeys(event: KeyboardEvent, index: number) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
    // Restore the trigger before the browser performs normal forward/backward tab navigation.
    if (event.key === 'Tab') { closeMenu(); return; }
    const next = event.key === 'ArrowDown' ? (index + 1) % formats.length
      : event.key === 'ArrowUp' ? (index + formats.length - 1) % formats.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? formats.length - 1
      : event.key.length === 1 && /^[\p{L}\p{N}]$/u.test(event.key) ? formats.findIndex(format => t(format.label).toLocaleLowerCase(locale).startsWith(event.key.toLocaleLowerCase(locale))) : -1;
    if (next >= 0) { event.preventDefault(); items.current[next]?.focus(); }
  }

  return <div className={`fs-format-switch ${active ? 'is-active' : ''}`} ref={root} role="group" aria-label={t('Text editing format')}>
    <button type="button" className="fs-format-activate" ref={main} aria-pressed={active} aria-controls="text-editor" disabled={disabled} onClick={() => { setOpen(false); onActivate(); }}><Icon name="code" size={15}/>{t(formats[selected].label)}</button>
    <button type="button" className="fs-format-menu-trigger" ref={trigger} aria-label={t('Change text format')} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} disabled={disabled}
      onClick={() => { if (open) closeMenu(); else showMenu(); }}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); showMenu(event.key === 'ArrowDown' ? 0 : formats.length - 1); } }}><Icon name="down" size={13}/></button>
    {open && <div className="fs-format-menu" id={menuId} role="menu" aria-label={t('Text format')}>
      {formats.map((format, index) => <button key={format.value} type="button" role="menuitemradio" aria-checked={value === format.value} tabIndex={-1} ref={element => { items.current[index] = element; }}
        onKeyDown={event => menuKeys(event, index)} onClick={() => { setOpen(false); onSelect(format.value); main.current?.focus(); }}><span>{t(format.label)}</span>{value === format.value && <Icon name="check" size={14}/>}</button>)}
    </div>}
  </div>;
}
