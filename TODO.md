# TODO

## PDF Toolbar (above PDF viewer)

A small toolbar that appears above the PDF once loaded.

- [x] **Import Image** — Add an external image (PNG/JPG) to the pdf
- [x] **Multi-image import** — Select several images at once; they import with a cascade offset
- [x] **Add Text** — Insert a new text block
- [x] **Undo / Redo** — Undo and redo all actions (Ctrl+Z / Ctrl+Shift+Z)
- [x] **Zoom In / Zoom Out** — Control the PDF view zoom level
- [x] **Add Page** — Insert a blank page before or after the current page
- [x] **Merge PDF** — Select another PDF file and append its pages after the current PDF
- [x] **Size indicator** — Live, byte-accurate size of the PDF as it would save right now
- [x] **Start blank PDF** — Create a one-page blank PDF from the upload zone, no file needed
- [x] **Cross-page drag** — Drag text and images between pages (auto-scrolls at viewer edges)
- [x] **Minimap scrollbar** — Thin live preview of all pages with a strip showing the viewport; click/drag to scroll

## Image Toolbar

A floating toolbar that appears when clicking on an image (similar to text format toolbar).

- [x] **Delete Image** — Remove an image from the PDF (trash icon button)
- [x] **Download Image** — Download the image as a file

## Drag Constraints

- [x] **Page-bound dragging** — Prevent dragging text or images outside their page boundaries

## Bug Fixes

- [x] **EXIF orientation on imported photos** — Photos with an EXIF rotation tag (phone cameras) were embedded with raw bytes, so the saved PDF showed them rotated. Now re-encoded upright at import.
- [x] **Image compression on import** — Ask for a compression level (High/Balanced/Smallest/Original) when importing images; re-encodes and downscales client-side
- [x] **Minimap shows overlays** — Imported/moved images and new/edited text render in the minimap thumbnails
- [x] **Sticky editor bars** — Toolbar and tools bar stay pinned to the top of the viewport while the editor is on screen
- [x] **UX polish** — Auto-scroll (smooth) to the editor on PDF load; drawings render in the minimap; reduced empty space below the editor

## Backlog — Bugs detectados (análisis 2026-08-13)

- [x] **Enter/Escape al editar texto solo funcionan como primera tecla** — el listener de keydown usa `{once:true}`, así que tras teclear cualquier letra, Enter inserta un salto de línea en vez de confirmar (js/editor.js:66)
- [x] **Selector muerto en editor.js** — `querySelectorAll('.text-item')` no coincide con la clase real `editable-text`; no cierra otros editores abiertos (js/editor.js:11)
- [x] **Resize de imágenes impreciso con zoom ≠ 100%** — los deltas de ratón no se escalan a píxeles de canvas como ya hace el drag (js/renderer.js startResize)
- [x] **Undo de página en blanco con contenido** — verificado: el historial se deshace en orden (contenido primero, página después), no hay caso huérfano real
- [x] **Inyección de HTML en modales** — showPrompt/showChoices meten strings via innerHTML; un nombre de archivo con comillas/HTML rompe el modal (js/ui.js)
- [x] **La compresión convierte PNG→JPEG** — pierde transparencia; detectar canal alfa y mantener PNG
- [x] **Undo de borrar texto marca 'modified'** — restaurar un texto no modificado le pone borde verde espurio (js/toolbar.js fmtDelete)
- [x] **PDFs con contraseña** — fallan con alert genérico; PDF.js soporta password callback
- [~] **Guardar sin cambios re-serializa el PDF** — descartado (impacto mínimo)
- [x] **Zoom solo CSS** — borroso al acercar; overflow horizontal raro con zoom > 100%; re-renderizar canvas al cambiar zoom

## Backlog — Mejoras de lo existente

- [x] **Soporte táctil/móvil** — drag, resize y draw usan solo eventos de ratón; migrar a Pointer Events
- [x] **Self-host de pdf.js/pdf-lib/fontkit (+SRI)** — coherente con "tu PDF nunca sale de tu dispositivo"; hoy dependen de CDN; habilita PWA/offline
- [x] **Deduplicar imágenes idénticas al guardar** — importar la misma foto N veces embebe N copias
- [x] **No preguntar compresión bajo un umbral** (p.ej. < 300 KB total)
- [x] **Estimador de tamaño en PDFs grandes** — reconstruye todo el PDF en cada acción; usar requestIdleCallback/umbral y un spinner mientras calcula
- [x] **Accesibilidad** — aria-labels en botones de solo-icono, foco visible, atajos de teclado documentados
- [ ] **Cover rects sobre fondos no uniformes** — en fondos con textura/gradiente el rectángulo de cobertura se nota; considerar inpainting simple o muestreo por bordes
- [ ] **Unificar findVisiblePage / currentPageContainer** (lógica duplicada en app.js)
- [~] **Tests e2e (Playwright) + CI** — descartado a propósito: las pruebas las ejecuta el agente (Claude) con el navegador siguiendo CLAUDE.md

## Backlog — Funcionalidades nuevas

- [x] **Eliminar página** y **reordenar páginas** (drag & drop en el minimapa)
- [x] **Rotar páginas** y **rotar imágenes** (además del resize)
- [x] **Split/extraer rango de páginas** a un PDF nuevo
- [x] **Anotaciones** — resaltador, formas (rectángulo, flecha), notas
- [x] **Firma** — dibujar o importar firma y colocarla (caso de uso estrella de estos editores)
- [x] **Fuente y alineación para textos nuevos** (selector de familia, izquierda/centro/derecha)
- [x] **Buscar texto** en el documento
- [x] **Soltar imágenes directamente sobre la página** (drag & drop de imagen = import)
- [x] **Multi-selección** (Shift+click) para mover/borrar varios elementos
- [x] **Autosave/recuperación** — persistir sesión en IndexedDB para sobrevivir recargas

## Sesión 2026-08-13 — features nuevas

- [x] **Sign** — Dibujar firma en un modal y colocarla como PNG transparente (arrastrable/redimensionable)
- [~] **Split** — retirado a petición del usuario; en su lugar hay botón **Delete Page** en la barra (borra la página actual con todo, con undo)
- [x] **Find** — Buscar texto (Ctrl+F) con resaltado y navegación entre coincidencias
- [x] **Reordenar/eliminar/rotar páginas** — Desde el minimapa (asa de arrastre, ✕, ⟳); el guardado reconstruye el documento copiando páginas en el orden del DOM
- [x] **Rotar imágenes importadas** — Botón en el toolbar de imagen (90°)
- [x] **Multi-selección** — Shift+click; mover en grupo y borrar en grupo con undo
- [x] **Fuente y alineación** — Selector Helvetica/Times/Courier + izquierda/centro/derecha en el toolbar de texto
- [x] **Anotaciones** — Subrayador, rectángulo y flecha en la paleta de dibujo
- [x] **Autosave** — Recuperación de sesión desde IndexedDB al volver a la página
- [x] **Drop de imágenes** — Soltar imágenes sobre una página las importa en esa posición
- [x] **Multilínea** — Shift+Enter inserta salto de línea; Enter confirma; el guardado respeta las líneas
- [x] **Zoom nítido** — Re-render del canvas a la resolución del zoom (backing desacoplado del layout)
- [x] **Shapes como herramienta propia** — separada de Draw; rect, círculo, flecha y estrella
- [x] **Formas editables** — selección con recuadro punteado + tiradores de redimensionado (esquinas / extremos de flecha), mover arrastrando, color de línea, relleno o transparente, papelera; toolbar flotante que sigue a la figura; auto-selección al crearla
- [x] **Barra agrupada** — herramientas en grupos visuales (historial / contenido / páginas / vista) que envuelven como bloques en pantallas estrechas
- [x] **Lógica de herramientas coherente** — herramientas de contenido mutuamente excluyentes (Sign/Import/Merge sueltan Draw/Shapes); Escape suelta cualquier modo; Supr borra la forma seleccionada; texto se confirma al clicar fuera (antes quedaba en edición si clicabas una forma/imagen)
- [x] **Firma/imágenes usables en táctil** — tiradores visibles al seleccionar (no solo hover) y targets de 22px en pantallas táctiles; imagen única importada queda auto-seleccionada
