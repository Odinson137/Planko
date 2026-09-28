import { useEffect } from 'react';
import { clipboardShortcut } from '../application/commands/ClipboardShortcut';
import { useClipboardStore } from '../application/stores/useClipboardStore';
import { useEditorStore } from '../application/stores/useEditorStore';
import { editingText } from './useProjectHistory';

export function useWallClipboard() {
  useEffect(() => {
    const acceptsObjects = (target: EventTarget | null) => {
      const editor = useEditorStore.getState();
      return !editingText(target) && !document.querySelector('[role="dialog"]') &&
        editor.activeTool !== 'CUT_PANEL' && editor.editMode !== 'WALLS';
    };
    const onKey = (event: KeyboardEvent) => {
      const clipboard = useClipboardStore.getState();
      if (event.key === 'Escape' && clipboard.preview) { event.preventDefault(); clipboard.cancel(); return; }
      if (!acceptsObjects(event.target)) return;
      const action = clipboardShortcut(event);
      if (!action || event.repeat) return;
      event.preventDefault();
      if (action === 'copy') clipboard.copy();
      else if (action === 'paste') clipboard.beginPaste();
      else if (clipboard.copy()) clipboard.beginPaste();
    };
    // Browser/Electron Edit menu commands can dispatch clipboard events without keydown.
    const onCopy = (event: ClipboardEvent) => {
      if (!acceptsObjects(event.target) || !useClipboardStore.getState().copy()) return;
      event.preventDefault();
      event.clipboardData?.setData('text/plain', 'Planko: объекты стены');
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!acceptsObjects(event.target) || !useClipboardStore.getState().content) return;
      event.preventDefault();
      useClipboardStore.getState().beginPaste();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('copy', onCopy);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('copy', onCopy); window.removeEventListener('paste', onPaste); };
  }, []);
}
