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

## Sesión 2026-08-13 (tarde) — bugs de dibujo/formas en móvil

- [x] **Scroll al dibujar en iOS** — iOS Safari ignora `touch-action: none` en elementos SVG; ahora el overlay de dibujo (y los trazos/recuadro de selección) hacen `preventDefault()` del `touchstart`, así que dibujar con el dedo ya no desplaza la página
- [x] **Selección punteada no seguía a la figura al moverla** — los tiradores/recuadro se desplazan en vivo durante el drag y se reposicionan al soltar, deshacer y rehacer
- [x] **Selección desalineada respecto a la figura** — el canvas de página era inline con margen propio, inflando el contenedor ~25px; el overlay SVG se estiraba y los trazos se pintaban más abajo que sus coordenadas. Canvas ahora `display:block` sin margen (el espaciado lo pone el contenedor)
- [x] **Mover una forma exigía acertar en el trazo** — el recuadro punteado de selección ahora es superficie de arrastre: se puede mover la forma desde cualquier punto interior (las esquinas siguen redimensionando)
- [x] **Borrar una forma dejaba la selección huérfana** — borrar, deshacer un trazo recién dibujado y cargar un documento nuevo limpian tiradores + toolbar flotante
- [x] **Add Text en móvil no mostraba la toolbar** — el handler de colocación era async (await getPage); en iOS el focus() tras un await queda fuera del gesto y Safari lo revoca con blur, cerrando la toolbar al instante. Ahora es síncrono (lee dataset.pdfWidth) y las toolbars flotantes siguen al visualViewport (teclado móvil)
- [x] **Toolbar del lápiz mostraba dos colores** — el relleno solo aplica a formas cerradas; para lápiz/subrayador/flecha se oculta el selector de relleno
- [x] **Trazos libres sin recuadro de selección** — ahora muestran el mismo recuadro punteado que las formas (sin tiradores de resize) y se pueden arrastrar desde dentro
- [x] **Selección nativa azul del canvas en móvil** — user-select none en el visor (el texto en edición sigue siendo seleccionable)
- [x] **Firma invisible (negro sobre negro)** — el lienzo del modal de firma ahora tiene fondo blanco por CSS; el bitmap sigue transparente, así que el PNG exportado no cambia
- [x] **Toolbar de texto desaparecía con el teclado (iOS)** — las toolbars flotantes ahora se clampan a la banda visible del visualViewport (entre barra de URL y teclado); antes quedaban recortadas fuera de pantalla al abrirse el teclado
- [x] **Selector de color no abría en móvil** — el preventDefault de pointerdown de las toolbars flotantes ya no se aplica a inputs/selects (en iOS bloqueaba el foco nativo que abre el picker)
- [x] **Grosor y opacidad en la toolbar de trazos/figuras** — dos sliders compactos con preview en vivo y un solo paso de undo por gesto (también con teclado)
- [x] **Colocar firma no deseleccionaba el trazo activo** — selecciones exclusivas en ambos sentidos (imagen⇄trazo); el contorno de imagen seleccionada ahora es punteado como el resto
- [x] **Toolbar de texto pegada al texto con teclado abierto** — el posicionado ahora es auto-corrector: coloca, mide dónde aterrizó de verdad (los navegadores móviles anclan fixed de forma distinta con teclado) y compensa la diferencia
- [x] **Selección huérfana al tocar zona vacía** — el cierre automático de las toolbars flotantes ahora dispara onHide con limpieza del contorno/tiradores (imagen y trazo); ya no pueden quedar dos cosas seleccionadas
- [x] **Opacidad dentro de la paleta de color** — con `<input type=color alpha>` (Chrome 133+/Safari modernos) la opacidad va en el propio selector nativo y desaparecen los sliders sueltos (paleta de dibujo y toolbar de trazo); fallback automático a sliders donde no hay soporte
- [x] **Selector de color propio** — popover custom (cuadro S/V + tono + opacidad + 12 swatches) que reemplaza los input color nativos en paleta de dibujo, toolbar de trazos (línea y relleno) y color de texto; mismo UI en PC y móvil, sin el panel del sistema iOS (adiós al "+")
- [x] **Opacidad solo dentro de la paleta de colores** — fuera los sliders sueltos de opacidad (paleta y toolbar de trazos) y fuera el botón de relleno transparente (relleno al 0% = sin relleno); el relleno tiene ahora su propia opacidad, compuesta con la del trazo al guardar
- [x] **Opacidad en el color del texto** — de punta a punta: en pantalla (rgba) y en el PDF guardado (drawText opacity, forzando la fuente de respaldo porque el stream de fuente original no soporta transparencia); undo restaura el color base
- [x] **Cancel del modal de firma no cerraba** — el botón Clear compartía la clase modal-btn--cancel y capturaba el listener; selector ahora scoped a .modal-actions
- [x] **Colores negros en el PDF guardado** — causa: el input nativo con alpha de iOS devolvía el color en formato no-hex que la pantalla aceptaba pero hexToRgb del saver no; con el selector propio el formato siempre es hex. Verificado ciclo dibujar→guardar→recargar: lápiz rojo, subrayador translúcido, relleno azul 50%, texto naranja 60% — todo correcto
- [x] **Swatch de color invisible en las toolbars** — la regla de tooltips ([data-tip]::after con opacity 0) pisaba la capa de color de los botones swatch, que también usaba ::after; movida a ::before
- [x] **Slider de opacidad degradaba a blanco** — ahora el degradado va de transparente al color seleccionado y se regenera al cambiar el tono
- [x] **Popover de color se cierra al tocar fuera** — el listener de cierre pasa a fase de captura (los elementos del editor cortan la propagación y lo dejaban abierto)
- [x] **Redimensionar formas en móvil (estrella)** — los tiradores tienen ahora un área táctil invisible ampliada (~44px en táctil); antes a 8px del centro el toque caía en la superficie de arrastre y movía la forma
- [x] **Error al guardar con firma** — no reproducible con documentos nuevos; causa probable: trazo con color en formato legado (input nativo+alpha de iOS) que abortaba todo el guardado. Blindado: color ilegible cae a negro en vez de romper el guardado, y el toast de error ahora muestra el mensaje real
- [x] **Error al guardar con firma — RESUELTO de verdad** — el toast con mensaje real lo destapó: `crypto.subtle` no existe en contextos no seguros (HTTP por IP de LAN; en HTTPS/localhost sí) y el hash de dedupe de imágenes rompía el guardado. Fallback a hash FNV-1a sin crypto.subtle
- [x] **Popover de color enterrado bajo el teclado** — ahora se reposiciona al abrir/cerrar el teclado o hacer scroll (antes solo se colocaba al abrirse)
- [x] **Swatches del popover restablecen opacidad al 100%**
- [x] **Seleccionar trazos sin puntería** — halo de 22px alrededor de cada trazo (hit-test geométrico con isPointInStroke sobre toques de fondo); las formas rellenas también se seleccionan tocando su interior
- [x] **Lienzo de firma desbordaba el modal en móvil** — ancho fluido con aspect-ratio fijo (el ancho inline de 560px pisaba el width:100% del CSS)

## Sesión 2026-08-13 (noche) — suite e2e Playwright

- [x] **Suite e2e completa** — 62 tests en `tests/e2e/`: carga (fixture multipágina, PDF en blanco, cifrado con contraseña), texto (edición, formato, color+opacidad, multilínea, drag, multiselección, guardado), dibujo (pen/subrayador/4 formas, popover color/relleno, grosor, halo, handles, undo/redo, guardado con colores), imágenes (import, EXIF, drag/resize/rotate/delete, guardado), firma (modal, cancel/clear, transparencia, guardado), páginas (añadir/borrar/merge/zoom/minimap/buscar), flujo combinado completo, y proyecto táctil (no-scroll al dibujar, halo táctil)
- [x] **regressions.spec.js** — un test por cada bug de las sesiones de hoy; REGLA PERMANENTE: todo bug nuevo se confirma con un test e2e antes de dar el fix por cerrado
- [x] **Push bloqueado sin tests** — hook pre-push versionado en .githooks/ (activado con `git config core.hooksPath .githooks`) que ejecuta la suite completa
- [x] **README actualizado** — lista completa de funcionalidades + sección de testing; enlace de GitHub → FVJohnny/edit-pdf-free
- [x] **Cobertura e2e completada (revisión honesta)** — 14 tests más en coverage.spec.js: drag entre páginas con undo, import multi-imagen con modal de compresión (Balanced), rotar/borrar página desde el minimapa, zoom nítido (re-render del backing), recuperación de sesión con edición horneada, Shift+resize (aspecto), descargar imagen, contraseña errónea con reintento, ciclo del buscador, borrado multi-selección con un undo, Escape/Supr, borrar texto con undo, posición exacta de página insertada. Total: 76 tests + 3 táctiles
