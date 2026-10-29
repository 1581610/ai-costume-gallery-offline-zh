"""Offline workflow and real native image drag regression in isolated Edge."""
from pathlib import Path
import hashlib
import json
import sys
import threading
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from serve import Server,Handler

def main():
    errors=[];external=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='msedge',headless=True)
        context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
        p=context.new_page();p.on('pageerror',lambda e:errors.append(str(e)))
        p.on('request',lambda r:external.append(r.url) if r.url.startswith(('https:','http:')) else None)
        p.goto((ROOT/'index.html').as_uri())
        expect(p.locator('.card')).to_have_count(48)
        expect(p.locator('#resultCount')).to_have_text('1,407 套服装')
        p.click('#categories [data-line="泳装"]');expect(p.locator('#resultCount')).to_have_text('54 套服装')
        p.click('#resetBtn');p.fill('#search','蕾丝 黑色')
        expect(p.locator('.card').first).to_be_visible()
        p.wait_for_function("()=>document.querySelector('#activeFilters').textContent.includes('蕾丝 黑色')")
        ids=p.locator('.card').evaluate_all('els=>els.map(e=>e.dataset.id)')
        index=json.loads((ROOT/'data/index.zh-CN.json').read_text(encoding='utf-8'))
        by_id={d['id']:d for d in index}
        assert ids and all('蕾丝' in by_id[i]['keywordsZh'] and '黑色' in by_id[i]['keywordsZh'] for i in ids)
        p.click('#resetBtn');p.select_option('#color','粉色')
        assert all('粉色' in by_id[i]['colors'] for i in p.locator('.card').evaluate_all('els=>els.map(e=>e.dataset.id)'))
        p.click('#resetBtn');p.locator('.card').first.click()
        p.wait_for_function("()=>document.querySelector('#fullImage').naturalWidth===1366")
        p.click('#favImage');p.fill('#costumeNote','用于春日角色穿搭')
        p.click('#pinImage');p.click('#addCollection');p.fill('#dialogValue','春日衣橱');p.press('#dialogValue','Enter')
        expect(p.locator('#collections [data-scope]')).to_have_count(1)
        p.click('#closeViewer');p.reload();p.locator('.card').first.click()
        expect(p.locator('#favImage')).to_have_text('已收藏此套')
        expect(p.locator('#costumeNote')).to_have_value('用于春日角色穿搭')
        p.click('#mirrorImage');assert p.locator('#fullImage').evaluate('el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).a<0')
        p.click('#closeViewer');p.locator('.card').nth(1).click();p.click('#closeViewer');p.locator('.card').first.click();p.click('#closeViewer')
        assert p.evaluate("JSON.parse(localStorage.getItem('costume_index_v1')).recent[0]")=='SPR-0001'
        p.locator('.card-check').first.check();p.click('#selectionCollection');p.click('#dialogConfirm')
        expect(p.locator('#toast')).to_contain_text('已加入')
        with p.expect_download() as event:p.click('#backupBtn')
        backup=json.loads(Path(event.value.path()).read_text(encoding='utf-8'))
        assert backup['favImages']==['SPR-0001'] and backup['collections'][0]['items']==['SPR-0001']
        p.set_input_files('#importInput',{'name':'backup.json','mimeType':'application/json','buffer':json.dumps(backup).encode()})
        p.click('#dialogConfirm');expect(p.locator('#collections [data-scope]')).to_have_count(1)
        p.click('#selectionClear');p.click('#boardBtn');expect(p.locator('.board-card')).to_have_count(1);p.click('#closeBoard')
        for w,h in [(1440,1000),(1280,720),(390,844),(360,640),(740,360)]:
            p.set_viewport_size({'width':w,'height':h});assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
            p.locator('.card').first.click();p.wait_for_function("()=>document.querySelector('#fullImage').naturalWidth===1366")
            r=p.locator('#fullImage').bounding_box();assert r['x']>=0 and r['y']>=0 and r['x']+r['width']<=w+1 and r['y']+r['height']<=h+1
            p.click('#closeViewer')
        p.set_viewport_size({'width':390,'height':844});p.goto((ROOT/'index.html').as_uri());p.evaluate('scrollTo(0,0)');p.screenshot(path=str(ROOT/'tests/artifacts/mobile.png'))
        p.set_viewport_size({'width':1440,'height':1000});p.screenshot(path=str(ROOT/'tests/artifacts/desktop.png'))
        assert not errors,errors
        assert not external,external
        print('PASS offline search, filters, favourites, notes, collections, backup import/export, reference board, revisit order, five viewports; zero external requests/errors',flush=True)
        server=Server(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            page=context.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/');page.locator('.card').first.click()
            page.wait_for_function("()=>document.querySelector('#fullImage').naturalWidth===1366")
            with page.expect_download() as event:page.click('#downloadImage')
            digest=hashlib.sha256((ROOT/'assets/images/SPR-0001.png').read_bytes()).hexdigest()
            assert hashlib.sha256(Path(event.value.path()).read_bytes()).hexdigest()==digest
            page.locator('#viewer').evaluate('''el=>{const zone=document.createElement('div');zone.id='drop-test';zone.style.cssText='position:absolute;right:20px;top:200px;width:220px;height:140px;background:lightblue;z-index:100';zone.ondragover=e=>e.preventDefault();zone.ondrop=async e=>{e.preventDefault();const files=[...e.dataTransfer.files];if(files.length!==1){window.dropped={error:'Invalid file payload'};return;}const f=files[0],im=await createImageBitmap(f),hash=await crypto.subtle.digest('SHA-256',await f.arrayBuffer());window.dropped={width:im.width,height:im.height,hash:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')};im.close();};el.append(zone);}''')
            image=page.locator('#fullImage').bounding_box();zone=page.locator('#drop-test').bounding_box();x=image['x']+image['width']/2;y=image['y']+image['height']/2;tx=zone['x']+100;ty=zone['y']+70
            session=context.new_cdp_session(page);session.send('Input.setInterceptDrags',{'enabled':False})
            session.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':x,'y':y,'buttons':0})
            session.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':x,'y':y,'button':'left','buttons':1,'clickCount':1})
            for i in range(1,21):session.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':x+(tx-x)*i/20,'y':y+(ty-y)*i/20,'button':'left','buttons':1})
            session.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':tx+2,'y':ty,'button':'left','buttons':1})
            session.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':tx+2,'y':ty,'button':'left','buttons':0,'clickCount':1})
            page.wait_for_function('()=>!!window.dropped');dropped=page.evaluate('window.dropped')
            assert dropped=={'width':1366,'height':2048,'hash':digest},dropped
            print('PASS actual native drag and original PNG download: exact SHA256, 1366x2048',flush=True)
        finally:server.shutdown();server.server_close()
        context.close();browser.close()
    manifest=json.loads((ROOT/'data/asset-manifest.json').read_text(encoding='utf-8'))
    assert len(manifest)==4221 and all((ROOT/path).stat().st_size==meta['bytes'] for path,meta in manifest.items())
    print('PASS complete original PNG, preview WebP and thumbnail manifest',flush=True)

if __name__=='__main__':main()
