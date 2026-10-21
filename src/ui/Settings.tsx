import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';
import type { ThemePreference } from './theme';

interface AppMenuProps {
  mobile?: boolean;
  onSettings: (trigger: HTMLButtonElement | null) => void;
}

/** A small workspace menu, not an account menu. */
export function AppMenu({ mobile = false, onSettings }: AppMenuProps) {
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
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End', 's', 'S'].includes(event.key)) { event.preventDefault(); item.current?.focus(); }
  }
  return <div className={`fs-app-menu ${mobile ? 'fs-app-menu-mobile' : ''}`} ref={root}>
    <button type="button" className="fs-app-menu-trigger" aria-label="Open FolderSeed menu" title="FolderSeed menu" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} ref={trigger}
      onClick={() => { if (open) closeMenu(); else setOpen(true); }}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
      {mobile ? <Icon name="settings" size={20}/> : <><span>FolderSeed · v0.1</span><Icon name="up" size={13}/></>}
    </button>
    {open && <div className="fs-app-menu-popover" id={menuId} role="menu" aria-label="FolderSeed">
      <button type="button" role="menuitem" tabIndex={-1} ref={item} onKeyDown={menuKeys} onClick={() => { closeMenu(); onSettings(trigger.current); }}><Icon name="settings" size={18}/>Settings</button>
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
  const dialog = useRef<HTMLDialogElement>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const headingId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    dialog.current?.showModal();
    radios.current[themes.findIndex(theme => theme.value === preference)]?.focus();
  }, []);
  function close() { dialog.current?.close(); onClose(); }
  function themeKeys(event: KeyboardEvent, index: number) {
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % themes.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + themes.length - 1) % themes.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? themes.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); onPreferenceChange(themes[next].value); radios.current[next]?.focus(); }
  }
  return <dialog ref={dialog} className="fs-dialog fs-settings-dialog" aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }}>
    <div className="fs-dialog-top"><span className="fs-dialog-icon"><Icon name="settings" size={25}/></span><button type="button" className="fs-icon-button" aria-label="Close settings" onClick={close}><Icon name="close"/></button></div>
    <h2 id={headingId}>Settings</h2>
    <p>Make this workspace feel like yours.</p>
    <h3 className="fs-settings-heading">Theme</h3>
    <div className="fs-theme-options" role="radiogroup" aria-label="Theme" aria-describedby={descriptionId}>
      {themes.map((theme, index) => <button key={theme.value} type="button" role="radio" aria-checked={preference === theme.value} tabIndex={preference === theme.value ? 0 : -1} ref={element => { radios.current[index] = element; }} onClick={() => onPreferenceChange(theme.value)} onKeyDown={event => themeKeys(event, index)}><Icon name={theme.icon} size={23}/><span>{theme.label}</span></button>)}
    </div>
    <p className="fs-theme-description" id={descriptionId}>{preference === 'system' ? 'Follows your device appearance, including automatic changes.' : `Always use the ${preference} appearance on this device.`}</p>
    {storageWarning && <p className="fs-settings-storage-note" role="status">{storageWarning}</p>}
    <div className="fs-dialog-actions"><button type="button" className="fs-button fs-primary" onClick={close}>Done</button></div>
  </dialog>;
}
