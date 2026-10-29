"""Build a portable Chinese costume gallery with local image references."""
from pathlib import Path
import json
import re

ROOT=Path(__file__).resolve().parents[1]
GARMENTS='dress skirt jeans pants shorts blouse shirt camisole knit sweater cardigan hoodie turtleneck coat jacket vest bra briefs corset swimsuit robe apron'.split()
COLORS='ivory white cream beige khaki brown black grey blue navy mint green olive yellow orange pink red burgundy purple lavender gold silver'.split()

def main():
    original=json.loads((ROOT/'data/original.json').read_text(encoding='utf-8'))
    trans=json.loads((ROOT/'data/translations.zh-CN.json').read_text(encoding='utf-8'))
    terms,phrases=trans['terms'],trans['phrases']
    manifest=json.loads((ROOT/'data/asset-manifest.json').read_text(encoding='utf-8')) if (ROOT/'data/asset-manifest.json').exists() else {}
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
        data.append({'id':d['id'],'category':trans['categories'][d['カテゴリ']],'categoryJa':d['カテゴリ'],'name':title,'keywordsZh':' '.join(tokens),'keywordsEn':d['キーワード'],'types':types,'colors':colors,'full':full,'preview':f'assets/previews/{d["id"]}.webp','thumb':f'assets/thumbnails/{d["id"]}.webp','size':manifest.get(full,{}).get('size'),'bytes':manifest.get(full,{}).get('bytes')})
    (ROOT/'data/index.zh-CN.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    source=(ROOT/'src/shell.html').read_text(encoding='utf-8')
    for mark,path in [('STYLE','style.css'),('APP','app.js')]:source=source.replace(f'/*__{mark}__*/',(ROOT/'src'/path).read_text(encoding='utf-8'))
    source=source.replace('/*__DATA__*/',json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c'))
    staged=ROOT/'index.html.tmp';staged.write_text(source,encoding='utf-8');staged.replace(ROOT/'index.html')
    print(f'Built {len(data)} costumes; {len(terms)} Chinese search terms.',flush=True)

if __name__=='__main__':main()
