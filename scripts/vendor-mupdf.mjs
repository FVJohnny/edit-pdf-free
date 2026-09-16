import {mkdir,copyFile,readFile} from 'node:fs/promises';
const root = new URL('../',import.meta.url);
const pkg = JSON.parse(await readFile(new URL('node_modules/mupdf/package.json',root),'utf8'));
await mkdir(new URL('vendor/mupdf/',root),{recursive:true});
for(const name of ['mupdf.js','mupdf-wasm.js','mupdf-wasm.wasm']) {
    await copyFile(new URL('node_modules/mupdf/dist/'+name,root),new URL('vendor/mupdf/'+name,root));
}
await copyFile(new URL('node_modules/mupdf/LICENSE',root),new URL('vendor/mupdf/LICENSE',root));
console.log(`Vendored unmodified MuPDF ${pkg.version}`);
