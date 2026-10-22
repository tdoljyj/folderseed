import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';
import type { ThemePreference } from './theme';
import { SUPPORTED_LANGUAGES, useI18n } from './i18n';

interface AppMenuProps {
  mobile?: boolean;
  onSettings: (trigger: HTMLButtonElement | null) => void;
}

/** A small workspace menu, not an account menu. */
export function AppMenu({ mobile = false, onSettings }: AppMenuProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    item.current?.focus();
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
  function closeMenu() { setOpen(false); trigger.current?.focus(); }
  function menuKeys(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); }
    else if (event.key === 'Tab') closeMenu();
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.key.toLocaleLowerCase(locale) === t('Settings').slice(0, 1).toLocaleLowerCase(locale)) { event.preventDefault(); item.current?.focus(); }
  }
  return <div className={`fs-app-menu ${mobile ? 'fs-app-menu-mobile' : ''}`} ref={root}>
    <button type="button" className="fs-app-menu-trigger" aria-label={t('Open FolderSeed menu')} title={t('FolderSeed menu')} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} ref={trigger}
      onClick={() => { if (open) closeMenu(); else setOpen(true); }}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
      {mobile ? <Icon name="settings" size={20}/> : <><span>FolderSeed · v0.1</span><Icon name="up" size={13}/></>}
    </button>
    {open && <div className="fs-app-menu-popover" id={menuId} role="menu" aria-label="FolderSeed">
      <button type="button" role="menuitem" tabIndex={-1} ref={item} onKeyDown={menuKeys} onClick={() => { closeMenu(); onSettings(trigger.current); }}><Icon name="settings" size={18}/>{t('Settings')}</button>
    </div>}
  </div>;
}

const themes: { value: ThemePreference; label: string; icon: string }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

interface SettingsDialogProps {
  preference: ThemePreference;
  storageWarning: string;
  onPreferenceChange: (preference: ThemePreference) => void;
  onClose: () => void;
}

export function SettingsDialog({ preference, storageWarning, onPreferenceChange, onClose }: SettingsDialogProps) {
  const language = useI18n();
  const { t, direction } = language;
  const dialog = useRef<HTMLDialogElement>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const headingId = useId();
  const descriptionId = useId();
  const languageId = useId();
  const languageDescriptionId = useId();
  useLayoutEffect(() => {
    dialog.current?.showModal();
    radios.current[themes.findIndex(theme => theme.value === preference)]?.focus();
  }, []);
  function close() { dialog.current?.close(); onClose(); }
  function dialogKeys(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)')]
      .filter(button => button.tabIndex >= 0 && button.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (first && last && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }
  function themeKeys(event: KeyboardEvent, index: number) {
    const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    const next = event.key === forward || event.key === 'ArrowDown' ? (index + 1) % themes.length
      : event.key === backward || event.key === 'ArrowUp' ? (index + themes.length - 1) % themes.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? themes.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); onPreferenceChange(themes[next].value); radios.current[next]?.focus(); }
  }
  return <dialog ref={dialog} className="fs-dialog fs-settings-dialog" aria-labelledby={headingId} onKeyDown={dialogKeys}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }}>
    <div className="fs-dialog-top"><span className="fs-dialog-icon"><Icon name="settings" size={25}/></span><button type="button" className="fs-icon-button" aria-label={t('Close settings')} onClick={close}><Icon name="close"/></button></div>
    <h2 id={headingId}>{t('Settings')}</h2>
    <p>{t('Make this workspace feel like yours.')}</p>
    <h3 className="fs-settings-heading">{t('Theme')}</h3>
    <div className="fs-theme-options" role="radiogroup" aria-label={t('Theme')} aria-describedby={descriptionId}>
      {themes.map((theme, index) => <button key={theme.value} type="button" role="radio" aria-checked={preference === theme.value} tabIndex={preference === theme.value ? 0 : -1} ref={element => { radios.current[index] = element; }} onClick={() => onPreferenceChange(theme.value)} onKeyDown={event => themeKeys(event, index)}><Icon name={theme.icon} size={23}/><span>{t(theme.label)}</span></button>)}
    </div>
    <p className="fs-theme-description" id={descriptionId}>{t(preference === 'system' ? 'Follows your device appearance, including automatic changes.' : preference === 'light' ? 'Always use the light appearance on this device.' : 'Always use the dark appearance on this device.')}</p>
    {storageWarning && <p className="fs-settings-storage-note" role="status">{t(storageWarning)}</p>}
    <div className="fs-settings-language">
      <label className="fs-settings-heading" htmlFor={languageId}>{t('Language')}</label>
      <select id={languageId} className="fs-language-select" aria-label={t('Language')} aria-describedby={languageDescriptionId} value={language.preference} onChange={event => {
        const value = event.target.value;
        if (value === 'auto') language.setPreference('auto');
        else {
          const option = SUPPORTED_LANGUAGES.find(item => item.value === value);
          if (option) language.setPreference(option.value);
        }
      }}>
        <option value="auto">{t('Automatic')}</option>
        {SUPPORTED_LANGUAGES.map(option => <option key={option.value} value={option.value} lang={option.value}>{option.label}</option>)}
      </select>
      <p className="fs-theme-description" id={languageDescriptionId}>{t(language.preference === 'auto' ? 'Follows your device language, including automatic changes.' : 'The language you choose applies only to this workspace interface.')}</p>
      {language.storageError && <p className="fs-settings-storage-note" role="status">{t('Language is kept for this session only.')}</p>}
    </div>
    <div className="fs-dialog-actions"><button type="button" className="fs-button fs-primary" onClick={close}>{t('Done')}</button></div>
  </dialog>;
}
