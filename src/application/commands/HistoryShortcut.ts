type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'isComposing' | 'defaultPrevented'>;

export function historyShortcut(event: ShortcutEvent): 'undo' | 'redo' | null {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (event.code === 'KeyZ' || ['z', 'я'].includes(key)) return event.shiftKey ? 'redo' : 'undo';
  if (event.code === 'KeyY' || ['y', 'н'].includes(key)) return 'redo';
  return null;
}
