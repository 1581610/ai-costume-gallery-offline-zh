"""Download every public thumbnail, preview and original PNG; safe to resume."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image
import hashlib
import json
import re
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://ai-costume-gallery.pages.dev/'

def main():
    data=json.loads((ROOT/'data/original.json').read_text(encoding='utf-8'))
    jobs=[]
    for field,source_dir,target_dir,extension in [('サムネ','thumbs','thumbnails','webp'),('画像','img','previews','webp'),('原寸','png','images','png')]:
        for d in data:
            assert re.fullmatch(r'[A-Z]+-\d{4}', d['id'])
            assert d[field]==f'{source_dir}/{d["id"]}.{extension}'
            jobs.append((d[field],ROOT/f'assets/{target_dir}/{d["id"]}.{extension}',extension))
    def checked(path,ext):
        with Image.open(path) as image:
            if image.format != ('PNG' if ext=='png' else 'WEBP'):raise ValueError('Unexpected format')
            dimensions=image.size
            if min(dimensions)<100:raise ValueError('Unexpected image size')
            image.verify()
        return dimensions
    def fetch(job):
        source,target,ext=job
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.exists():
            try:
                dimensions=checked(target,ext)
                return str(target.relative_to(ROOT)).replace('\\','/'),{'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,'size':dimensions}
            except Exception:pass
        for attempt in range(4):
            try:
                req=urllib.request.Request(SOURCE+source,headers={'User-Agent':'Mozilla/5.0'})
                with urllib.request.urlopen(req,timeout=60) as response:content=response.read()
                part=target.with_suffix(target.suffix+'.part');part.write_bytes(content)
                dimensions=checked(part,ext);part.replace(target)
                return str(target.relative_to(ROOT)).replace('\\','/'),{'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content),'size':dimensions}
            except Exception:
                if attempt==3:raise
                time.sleep(2**attempt)
    manifest={};errors=[];start=time.monotonic()
    with ThreadPoolExecutor(8) as pool:
        work={pool.submit(fetch,j):j[0] for j in jobs}
        for i,future in enumerate(as_completed(work),1):
            try:
                name,record=future.result();manifest[name]=record
            except Exception as e:
                errors.append({'path':work[future],'error':str(e)});print('FAILED',errors[-1],flush=True)
            if i%100==0 or i==len(jobs):print(f'{i}/{len(jobs)} checked; {sum(x["bytes"] for x in manifest.values())/1024**3:.2f} GiB; {len(errors)} failed; {time.monotonic()-start:.0f}s',flush=True)
    (ROOT/'data/asset-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    (ROOT/'data/download-errors.json').write_text(json.dumps(errors,ensure_ascii=False,indent=2),encoding='utf-8')
    if errors:raise SystemExit(f'{len(errors)} files failed; rerun to resume')
    print('All costume assets verified.',flush=True)

if __name__=='__main__':main()
