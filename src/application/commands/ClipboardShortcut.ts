type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'isComposing' | 'defaultPrevented'>;

export function clipboardShortcut(event: ShortcutEvent): 'copy' | 'paste' | 'duplicate' | null {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (event.code === 'KeyC' || ['c', 'с'].includes(key)) return 'copy';
  if (event.code === 'KeyV' || ['v', 'м'].includes(key)) return 'paste';
  if (event.code === 'KeyD' || ['d', 'в'].includes(key)) return 'duplicate';
  return null;
}
