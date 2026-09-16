import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { loadFixture, saveAndReload, savePdf, drag, MAIN_PDF } from './helpers.js';
import fs from 'node:fs/promises';

async function fixture(testInfo) {
    const doc=await PDFDocument.create();
    const serif=await doc.embedFont(StandardFonts.TimesRoman);
    const bold=await doc.embedFont(StandardFonts.CourierBold);
    for(let i=0;i<2;i++){
        const page=doc.addPage([500,400]);
        // Nonuniform artwork behind the editable text must survive.
        page.drawRectangle({x:30,y:265,width:200,height:45,color:rgb(.8,.9,1)});
        page.drawRectangle({x:230,y:265,width:200,height:45,color:rgb(1,.9,.7)});
        page.drawLine({start:{x:30,y:277},end:{x:430,y:277},thickness:1,color:rgb(.1,.4,.8)});
        page.drawText('Original phrase '+i,{x:50,y:280,size:20,font:i?bold:serif,color:rgb(.2,.1,.5)});
        page.drawText('Keep this neighbour',{x:50,y:250,size:12,font:serif});
        page.drawText('Different style',{x:50,y:200,size:18,font:bold});
    }
    const path=testInfo.outputPath('source.pdf');await fs.writeFile(path,await doc.save());return path;
}

test('real text replacement removes original, retains neighbour and survives a second edit', async({page},testInfo)=>{
    await loadFixture(page,await fixture(testInfo));
    const span=page.locator('.editable-text').filter({hasText:'Original phrase 0'});
    await span.click();await page.keyboard.type('Replacement phrase');await page.keyboard.press('Enter');
    await saveAndReload(page);
    await expect(page.locator('.editable-text').filter({hasText:'Original phrase 0'})).toHaveCount(0);
    await expect(page.locator('.editable-text').filter({hasText:'Keep this neighbour'})).toHaveCount(2);
    const replaced=page.locator('.editable-text').filter({hasText:'Replacement phrase'});
    await expect(replaced).toHaveCount(1);
    await replaced.click();await page.keyboard.type('Final phrase');await page.keyboard.press('Enter');
    await saveAndReload(page);
    await expect(page.locator('.editable-text').filter({hasText:'Replacement phrase'})).toHaveCount(0);
    await expect(page.locator('.editable-text').filter({hasText:'Final phrase'})).toHaveCount(1);
});

test('delete really removes text; undo and redo preserve it correctly',async({page},testInfo)=>{
    await loadFixture(page,await fixture(testInfo));
    await page.locator('.editable-text').filter({hasText:'Original phrase 0'}).click();
    await page.click('#fmtDelete');
    await page.click('#undoBtn');
    await expect(page.locator('.editable-text').filter({hasText:'Original phrase 0'})).toBeVisible();
    await page.click('#redoBtn');
    await saveAndReload(page);
    await expect(page.locator('.editable-text').filter({hasText:'Original phrase 0'})).toHaveCount(0);
    await expect(page.locator('.editable-text').filter({hasText:'Original phrase 1'})).toHaveCount(1);
});

test('second-page original font remains Courier Bold after replacement',async({page},testInfo)=>{
    await loadFixture(page,await fixture(testInfo));
    await page.locator('.editable-text').filter({hasText:'Original phrase 1'}).click();
    await page.keyboard.type('Second page changed');await page.keyboard.press('Enter');
    await saveAndReload(page);
    const span=page.locator('.editable-text').filter({hasText:'Second page changed'});
    await expect(span).toHaveCount(1);
    expect(await span.evaluate(el=>el.style.fontFamily)).toContain('Courier');
    expect(await span.evaluate(el=>el.style.fontWeight)).toBe('700');
});

test('background artwork remains intact in preview and exported PDF',async({page},testInfo)=>{
    await loadFixture(page,await fixture(testInfo));
    const sample=()=>page.locator('canvas.pdf-page').first().evaluate(c=>{
        const ctx=c.getContext('2d');
        return [...ctx.getImageData(Math.round(c.width*100/500),Math.round(c.height*123/400),1,1).data];
    });
    const originalPixels=()=>page.locator('canvas.pdf-page').first().evaluate(c=>{
        const data=c.getContext('2d').getImageData(Math.round(c.width*50/500),Math.round(c.height*100/400),Math.round(c.width*175/500),Math.round(c.height*20/400)).data;
        let count=0;
        for(let i=0;i<data.length;i+=4) if(data[i]<100 && data[i+1]<60 && data[i+2]>70)count++;
        return count;
    });
    const before=await sample();
    expect(await originalPixels()).toBeGreaterThan(0);
    await page.locator('.editable-text').filter({hasText:'Original phrase 0'}).click();
    await page.click('#fmtDelete');
    await expect.poll(originalPixels).toBe(0);
    // Independent rasterizers can round a retained vector color by one channel value.
    await expect.poll(async()=>Math.max(...(await sample()).map((v,i)=>Math.abs(v-before[i])))).toBeLessThanOrEqual(2);
    await saveAndReload(page);
    expect(Math.max(...(await sample()).map((v,i)=>Math.abs(v-before[i])))).toBeLessThanOrEqual(2);
    await page.screenshot({path:testInfo.outputPath('background-after.png')});
});

test('original embedded font is reused and no hidden copy remains',async({page},testInfo)=>{
    await loadFixture(page);
    const original=page.locator('.editable-text').filter({hasText:'PDF Bookmark Sample'}).first();
    await original.click();
    const fontLabel=await page.locator('#fmtFont option').first().textContent();
    await page.keyboard.type('PDF Sample');await page.keyboard.press('Enter');
    await saveAndReload(page);
    const changed=page.locator('.editable-text').filter({hasText:/^PDF Sample$/}).first();
    await changed.click();
    expect(await page.locator('#fmtFont option').first().textContent()).toBe(fontLabel);
    await page.keyboard.press('Escape');
});

test('edit preserves a rotated text baseline',async({page},testInfo)=>{
    const doc=await PDFDocument.create();const p=doc.addPage([500,400]);
    const font=await doc.embedFont(StandardFonts.CourierBold);
    p.drawText('Rotated original',{x:180,y:80,size:18,font,rotate:{type:'degrees',angle:90}});
    const path=testInfo.outputPath('rotated.pdf');await fs.writeFile(path,await doc.save());
    await loadFixture(page,path);
    await page.locator('.editable-text').filter({hasText:/^original$/}).click();
    await page.keyboard.type('edited');await page.keyboard.press('Enter');
    await saveAndReload(page);
    const span=page.locator('.editable-text').filter({hasText:/^edited$/});
    await expect(span).toHaveCount(1);
    const box=await span.boundingBox();expect(box.height).toBeGreaterThan(box.width*2);
    await expect(page.locator('.editable-text').filter({hasText:/^original$/})).toHaveCount(0);
});

test('different inline fonts remain separate editable fragments',async({page},testInfo)=>{
    const doc=await PDFDocument.create();const p=doc.addPage([500,400]);
    const regular=await doc.embedFont(StandardFonts.TimesRoman),bold=await doc.embedFont(StandardFonts.TimesRomanBold);
    p.drawText('Regular ',{x:50,y:250,size:18,font:regular});
    p.drawText('Bold',{x:50+regular.widthOfTextAtSize('Regular ',18),y:250,size:18,font:bold});
    const file=testInfo.outputPath('mixed.pdf');await fs.writeFile(file,await doc.save());
    await loadFixture(page,file);
    await expect(page.locator('.editable-text').filter({hasText:/^Regular/})).toHaveText('Regular ');
    await page.locator('.editable-text').filter({hasText:/^Bold$/}).click();
    await page.keyboard.type('Strong');await page.keyboard.press('Enter');
    await saveAndReload(page);
    const changed=page.locator('.editable-text').filter({hasText:/^Strong$/});
    expect(await changed.evaluate(el=>el.style.fontWeight)).toBe('700');
    await expect(page.locator('.editable-text').filter({hasText:/^Regular/})).toHaveCount(1);
});


test('moving existing text saves only one copy and undo restores the original',async({page},testInfo)=>{
    await loadFixture(page,await fixture(testInfo));
    const span=page.locator('.editable-text').filter({hasText:'Original phrase 0'});
    await span.scrollIntoViewIfNeeded();
    const box=await span.boundingBox();
    await drag(page,{x:box.x+10,y:box.y+8},{x:box.x+110,y:box.y+68});
    await page.click('#undoBtn');
    await page.click('#redoBtn');
    await saveAndReload(page);
    await expect(page.locator('.editable-text').filter({hasText:'Original phrase 0'})).toHaveCount(1);
});

test('real text editing works by touch @touch',async({page},testInfo)=>{
    await loadFixture(page,await fixture(testInfo));
    const span=page.locator('.editable-text').filter({hasText:'Original phrase 0'});
    await span.tap();await span.tap();
    await page.keyboard.type('Touch replacement');await page.keyboard.press('Enter');
    await saveAndReload(page);
    await expect(page.locator('.editable-text').filter({hasText:'Original phrase 0'})).toHaveCount(0);
    await expect(page.locator('.editable-text').filter({hasText:'Touch replacement'})).toHaveCount(1);
});


test('alignment keeps the embedded original typeface',async({page})=>{
    await loadFixture(page);
    await page.locator('.editable-text').filter({hasText:'PDF Bookmark Sample'}).first().click();
    const fontLabel=await page.locator('#fmtFont option').first().textContent();
    await page.keyboard.type('PDF Sample');
    await page.click('#fmtAlignRight');
    await page.keyboard.press('Enter');
    await saveAndReload(page);
    await page.locator('.editable-text').filter({hasText:/^PDF Sample$/}).first().click();
    expect(await page.locator('#fmtFont option').first().textContent()).toBe(fontLabel);
});

for (const angle of [90, 180, 270]) {
    test(`page rotation ${angle}: editing retains the displayed position`, async ({page}, testInfo) => {
        const doc = await PDFDocument.create();
        const p = doc.addPage([500,400]);
        p.setRotation({type:'degrees', angle});
        p.drawText('Rotation',{x:70,y:250,size:20,font:await doc.embedFont(StandardFonts.CourierBold)});
        const file=testInfo.outputPath('page-rotation.pdf'); await fs.writeFile(file,await doc.save());
        await loadFixture(page,file);
        const original=page.locator('.editable-text').filter({hasText:/^Rotation$/});
        const before=await original.boundingBox();
        await original.click(); await page.keyboard.type('Modified'); await page.keyboard.press('Enter');
        await saveAndReload(page);
        const changed=page.locator('.editable-text').filter({hasText:/^Modified$/});
        await expect(changed).toHaveCount(1);
        const after=await changed.boundingBox();
        expect(Math.abs(after.x-before.x)).toBeLessThan(3);
        expect(Math.abs(after.y-before.y)).toBeLessThan(3);
        expect(await changed.evaluate(el=>el.style.fontFamily)).toContain('Courier');
        await expect(page.locator('.editable-text').filter({hasText:/^Rotation$/})).toHaveCount(0);
    });
}

test('text in a Form XObject retains its original font', async ({page},testInfo) => {
    const source=await PDFDocument.create();
    source.addPage([500,400]).drawText('Nested original',{x:70,y:250,size:20,font:await source.embedFont(StandardFonts.CourierBold)});
    const doc=await PDFDocument.create();
    const embedded=await doc.embedPdf(await source.save());
    doc.addPage([500,400]).drawPage(embedded[0]);
    const file=testInfo.outputPath('nested.pdf');await fs.writeFile(file,await doc.save());
    await loadFixture(page,file);
    await page.locator('.editable-text').filter({hasText:'Nested original'}).click();
    await page.keyboard.type('Nested edited');await page.keyboard.press('Enter');
    await saveAndReload(page);
    const changed=page.locator('.editable-text').filter({hasText:'Nested edited'});
    await expect(changed).toHaveCount(1);
    expect(await changed.evaluate(el=>el.style.fontFamily)).toContain('Courier');
    await expect(page.locator('.editable-text').filter({hasText:'Nested original'})).toHaveCount(0);
});

test('switching documents during a slow edit never recovers the previous PDF under the new name', async ({page},testInfo) => {
    let releaseEngine;
    const engineGate=new Promise(resolve=>releaseEngine=resolve);
    let engineRequested;
    const requested=new Promise(resolve=>engineRequested=resolve);
    await page.route('**/mupdf-wasm.wasm',async route=>{
        engineRequested(); await engineGate; await route.continue();
    });
    await loadFixture(page,await fixture(testInfo));
    await page.locator('.editable-text').filter({hasText:'Original phrase 0'}).click();
    await page.keyboard.type('Previous document');await page.keyboard.press('Enter');
    await requested;
    // Hold the engine while both preview and debounced autosave wait for it.
    await page.waitForTimeout(1800);
    const next=await PDFDocument.create();
    next.addPage([500,400]).drawText('NEW DOCUMENT',{x:50,y:250,size:20});
    const file=testInfo.outputPath('next-document.pdf');await fs.writeFile(file,await next.save());
    const chooserPromise=page.waitForEvent('filechooser');await page.click('#newFileBtn');
    await (await chooserPromise).setFiles(file);
    await expect(page.locator('.editable-text').filter({hasText:'NEW DOCUMENT'})).toHaveCount(1);
    releaseEngine();
    await expect.poll(()=>page.evaluate(async()=>{
        const {loadSession}=await import('/js/autosave.js');
        return (await loadSession())?.name;
    })).toBe('next-document');
    const recoveredText=await page.evaluate(async()=>{
        const {loadSession}=await import('/js/autosave.js');
        const session=await loadSession();
        const pdf=await pdfjsLib.getDocument({data:session.bytes}).promise;
        const content=await (await pdf.getPage(1)).getTextContent();
        await pdf.destroy();return content.items.map(item=>item.str).join(' ');
    });
    expect(recoveredText).toContain('NEW DOCUMENT');
    expect(recoveredText).not.toContain('Previous document');
});


test('embedded PDF page retains Arial instead of substituting Helvetica', async ({page},testInfo) => {
    const doc=await PDFDocument.create();
    const [embedded]=await doc.embedPdf(await fs.readFile(MAIN_PDF),[0]);
    doc.addPage([embedded.width,embedded.height]).drawPage(embedded);
    const file=testInfo.outputPath('embedded-arial.pdf');await fs.writeFile(file,await doc.save());
    await loadFixture(page,file);
    await page.locator('.editable-text').filter({hasText:'PDF Bookmark Sample'}).first().click();
    const label=await page.locator('#fmtFont option').first().textContent();
    await page.keyboard.type('PDF Sample');await page.keyboard.press('Enter');
    await saveAndReload(page);
    await page.locator('.editable-text').filter({hasText:/^PDF Sample$/}).first().click();
    expect(await page.locator('#fmtFont option').first().textContent()).toBe(label);
});

test('extra lines and accented characters survive export without overlapping',async({page},testInfo)=>{
    const doc=await PDFDocument.create();
    doc.addPage([500,400]).drawText('First line\nSecond line',{x:50,y:300,size:18,lineHeight:23,font:await doc.embedFont(StandardFonts.TimesRoman)});
    const file=testInfo.outputPath('multiline.pdf');await fs.writeFile(file,await doc.save());
    await loadFixture(page,file);
    await page.locator('.editable-text').filter({hasText:'First line'}).click();
    await page.keyboard.insertText('Café español');
    await page.keyboard.press('Shift+Enter');await page.keyboard.insertText('Deuxième ligne');
    await page.keyboard.press('Shift+Enter');await page.keyboard.insertText('Dritte Zeile');
    await page.keyboard.press('Shift+Enter');await page.keyboard.insertText('Quarta riga');
    await page.keyboard.press('Enter');
    const saved=await savePdf(page);
    const bytes=[...await fs.readFile(saved)];
    const lines=await page.evaluate(async bytes=>{
        const doc=await pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;
        const content=await (await doc.getPage(1)).getTextContent();await doc.destroy();
        return content.items.filter(i=>i.str.trim()).map(i=>({text:i.str,y:i.transform[5]}));
    },bytes);
    for(const text of ['Café español','Deuxième ligne','Dritte Zeile','Quarta riga']) {
        expect(lines.some(line=>line.text===text)).toBe(true);
    }
    const ys=lines.filter(line=>['Café español','Deuxième ligne','Dritte Zeile','Quarta riga'].includes(line.text)).map(line=>line.y);
    expect(new Set(ys).size).toBe(4);
    for(let i=1;i<ys.length;i++) expect(ys[i-1]-ys[i]).toBeGreaterThan(15);
});

test('Escape after a preview refresh restores the original text and export',async({page},testInfo)=>{
    await loadFixture(page,await fixture(testInfo));
    await page.locator('.editable-text').filter({hasText:'Original phrase 0'}).click();
    await page.keyboard.type('Discard this edit');
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape');
    await saveAndReload(page);
    await expect(page.locator('.editable-text').filter({hasText:'Original phrase 0'})).toHaveCount(1);
    await expect(page.locator('.editable-text').filter({hasText:'Discard this edit'})).toHaveCount(0);
});

test('content-only editing preserves original font, size, color, opacity and position',async({page},testInfo)=>{
    const doc=await PDFDocument.create();
    doc.addPage([500,400]).drawText('ABCDEFGH',{x:70,y:250,size:23,font:await doc.embedFont(StandardFonts.CourierBoldOblique),color:rgb(.2,.1,.5),opacity:.45});
    const file=testInfo.outputPath('style.pdf');await fs.writeFile(file,await doc.save());
    await loadFixture(page,file);
    const appearance=()=>page.locator('canvas.pdf-page').evaluate(c=>{
        const pixels=c.getContext('2d').getImageData(Math.round(c.width*70/500),Math.round(c.height*125/400),Math.round(c.width*60/500),Math.round(c.height*30/400)).data;
        const min=[255,255,255];for(let i=0;i<pixels.length;i+=4)for(let k=0;k<3;k++)min[k]=Math.min(min[k],pixels[i+k]);return min;
    });
    const before=await appearance();
    const span=page.locator('.editable-text').filter({hasText:'ABCDEFGH'});
    const style=await span.evaluate(el=>({family:el.style.fontFamily,size:el.style.fontSize,weight:el.style.fontWeight,style:el.style.fontStyle,left:el.style.left,top:el.style.top}));
    await span.click();await page.keyboard.type('ABCDEFGZ');await page.keyboard.press('Enter');
    await saveAndReload(page);
    const result=page.locator('.editable-text').filter({hasText:'ABCDEFGZ'});
    const afterStyle=await result.evaluate(el=>({family:el.style.fontFamily,size:el.style.fontSize,weight:el.style.fontWeight,style:el.style.fontStyle,left:el.style.left,top:el.style.top}));
    expect(afterStyle).toEqual(style);
    const after=await appearance();for(let k=0;k<3;k++)expect(Math.abs(after[k]-before[k])).toBeLessThanOrEqual(2);
});
