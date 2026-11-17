"""Package portable resources, including upstream files with pre-1980 timestamps."""
from pathlib import Path
import zipfile
import time

root=Path(__file__).resolve().parents[1]
folder=root/'dist/Folio-0.2.0-portable'
target=root/'dist/Folio-0.2.0-windows-x64-portable.zip'
temporary=target.with_suffix('.zip.tmp')
with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,strict_timestamps=False) as archive:
    for path in sorted(folder.rglob('*')):
        if not path.is_file():continue
        for attempt in range(10):
            try:
                # Read before adding the entry so a sharing violation cannot leave duplicates.
                data=path.read_bytes()
                break
            except PermissionError:
                if attempt==9:raise
                time.sleep(.5)
        info=zipfile.ZipInfo(path.relative_to(folder).as_posix(),date_time=(2026,11,16,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        archive.writestr(info,data,compresslevel=6)
temporary.replace(target)
print(f'Portable archive: {target} ({target.stat().st_size:,} bytes)')
