"""Complete Folio's native test picker by process ID. Used by verify-organizer.mjs."""
import sys
from pywinauto import Desktop
pid, mode, *paths = sys.argv[1:]
dialog = Desktop(backend='uia').window(process=int(pid), class_name='#32770')
dialog.wait('visible', timeout=30)
if mode == 'cancel':
    dialog.child_window(auto_id='2', control_type='Button').invoke()
else:
    value = paths[0] if len(paths) == 1 else ' '.join('"' + p + '"' for p in paths)
    title = 'Folder:' if mode == 'folder' else 'File name:'
    try:
        dialog.child_window(title=title, control_type='Edit').set_edit_text(value)
    except Exception:
        dialog.print_control_identifiers(depth=4)
        raise
    dialog.child_window(auto_id='1', control_type='Button').invoke()
