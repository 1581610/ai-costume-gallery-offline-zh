"""Build a portable Chinese costume gallery with local image references."""
from pathlib import Path
import argparse
import json
import re

ROOT=Path(__file__).resolve().parents[1]
GARMENTS='dress skirt jeans pants shorts blouse shirt camisole knit sweater cardigan hoodie turtleneck coat jacket vest bra briefs corset swimsuit robe apron'.split()
COLORS='ivory white cream beige khaki brown black grey blue navy mint green olive yellow orange pink red burgundy purple lavender gold silver'.split()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--hosted',action='store_true',help='Build an online page using original-site image URLs')
    args=parser.parse_args()
    original=json.loads((ROOT/'data/original.json').read_text(encoding='utf-8'))
    trans=json.loads((ROOT/'data/translations.zh-CN.json').read_text(encoding='utf-8'))
    terms,phrases=trans['terms'],trans['phrases']
    manifest=json.loads((ROOT/'data/asset-manifest.json').read_text(encoding='utf-8')) if (ROOT/'data/asset-manifest.json').exists() else {}
    prompt_file=ROOT/'data/prompts.en.json'
    prompts=json.loads(prompt_file.read_text(encoding='utf-8'))['prompts'] if prompt_file.exists() else {}
    data=[]
    for d in original:
        words=d['キーワード'].lower().split()
        unknown=set(words)-terms.keys()
        if unknown:raise ValueError(f'Untranslated terms: {unknown}')
        types=list(dict.fromkeys(terms[w] if w!='knit' else '针织衫' for w in words if w in GARMENTS))
        colors=list(dict.fromkeys(terms[w] for w in words if w in COLORS))
        keywords=d['キーワード'].lower()
        tokens=[]
        while keywords:
            hit=next((p for p in sorted(phrases,key=len,reverse=True) if keywords==p or keywords.startswith(p+' ')),None)
            if hit:tokens.append(phrases[hit]);keywords=keywords[len(hit):].lstrip()
            else:
                w,_,keywords=keywords.partition(' ');tokens.append(terms[w])
        title=(' / '.join(types[:3]) or trans['categories'][d['カテゴリ']]+'服装')
        if colors:title=colors[0]+' · '+title
        full=f'assets/images/{d["id"]}.png'
        item={'id':d['id'],'category':trans['categories'][d['カテゴリ']],'categoryJa':d['カテゴリ'],'name':title,'keywordsZh':' '.join(tokens),'keywordsEn':d['キーワード'],'types':types,'colors':colors,'full':full,'preview':f'assets/previews/{d["id"]}.webp','thumb':f'assets/thumbnails/{d["id"]}.webp','size':manifest.get(full,{}).get('size'),'bytes':manifest.get(full,{}).get('bytes'),'prompt':prompts.get(d['id'],'')}
        if args.hosted:
            if not re.fullmatch(r'[A-Z]+-\d{4}',d['id']):raise ValueError('Invalid image ID')
            for key,field,prefix,ext in [('full','原寸','png','png'),('preview','画像','img','webp'),('thumb','サムネ','thumbs','webp')]:
                path=f'{prefix}/{d["id"]}.{ext}'
                if d[field]!=path:raise ValueError(f'Unexpected source path: {d[field]}')
                item[key]='https://ai-costume-gallery.pages.dev/'+path
        data.append(item)
    if prompts:
        missing=[d['id'] for d in data if not d['prompt']]
        if missing:raise ValueError(f'{len(missing)} costumes have no English prompt, e.g. {missing[:5]}')
    if not args.hosted:(ROOT/'data/index.zh-CN.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    source=(ROOT/'src/shell.html').read_text(encoding='utf-8')
    source=source.replace('__GALLERY_MODE__','hosted' if args.hosted else 'offline')
    if args.hosted:
        source=source.replace("img-src 'self' data: blob: file:","img-src 'self' data: blob: file: https://ai-costume-gallery.pages.dev")
        source=source.replace("connect-src 'none'","connect-src https://ai-costume-gallery.pages.dev")
    for mark,path in [('STYLE','style.css'),('APP','app.js')]:source=source.replace(f'/*__{mark}__*/',(ROOT/'src'/path).read_text(encoding='utf-8'))
    source=source.replace('/*__DATA__*/',json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c'))
    output=ROOT/'dist/index.html' if args.hosted else ROOT/'index.html'
    output.parent.mkdir(parents=True,exist_ok=True)
    staged=output.with_suffix('.html.tmp');staged.write_text(source,encoding='utf-8');staged.replace(output)
    print(f'Built {output}: {len(data)} costumes; {len(terms)} Chinese search terms.',flush=True)

if __name__=='__main__':main()
