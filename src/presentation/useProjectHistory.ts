import { useEffect } from 'react';
import { historyShortcut } from '../application/commands/HistoryShortcut';
import { useProjectStore } from '../application/stores/useProjectStore';

function editingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest('textarea, select')) return true;
  const input = target.closest('input');
  return !!input && !['button', 'checkbox', 'radio', 'range', 'color', 'submit', 'reset', 'image', 'file', 'hidden'].includes(input.type);
}

/** Mounted once in the editor, including events from portaled inspectors. */
export function useProjectHistory() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editingText(event.target)) return;
      const action = historyShortcut(event);
      if (!action) return;
      event.preventDefault();
      useProjectStore.getState()[action]();
    };
    const onFocus = (event: FocusEvent) => {
      if (editingText(event.target)) useProjectStore.getState().beginHistoryGroup();
    };
    const onBlur = () => useProjectStore.getState().endHistoryGroup();
    window.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      onBlur();
    };
  }, []);
}
