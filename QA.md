# Validación del editor — 16 de septiembre de 2026

## Cambios implementados

| Área | Resultado | Regresiones principales |
| --- | --- | --- |
| Fuentes | Comprobación de caracteres y fuente original; confirmación antes de sustituir; fuentes Type3 originales en la vista confirmada y exportación. | `real-text.spec.js`, `quality.spec.js`, `type3-font.spec.js` |
| Párrafos | Agrupación por columna y estilo, interlineado original y avisos de solapamiento/desbordamiento. | `quality.spec.js` |
| Visor | Detalle a resolución de pantalla únicamente en las regiones visibles; liberación de superficies y documentos anteriores; acceso al borde izquierdo con zoom. | `preview-resolution.spec.js`, `loading.spec.js` |
| Imágenes | Eliminación de la aparición original; movimiento/redimensionado con transparencia, transformaciones y fondo conservados. | `quality.spec.js`, `images.spec.js` |
| Estructura | Conservación de campos, anotaciones, enlaces, marcadores, metadatos y adjuntos del documento original; referencias actualizadas al reorganizar páginas; formularios y marcadores del PDF añadido. | `document-integrity.spec.js` |
| Interacción | Barras táctiles estables, captura del puntero al arrastrar, controles del minimapa accesibles y guardado deshabilitado durante la carga. | `mobile-browser.spec.js`, `touch.spec.js`, `coverage.spec.js`, `loading.spec.js` |

Las regresiones existentes incluyen texto, dibujo, formas, firmas, imágenes, búsqueda, historial, recuperación de sesión, contraseñas de apertura y operaciones de páginas. Las comprobaciones de exportación vuelven a abrir el PDF e inspeccionan su texto, recursos, geometría o píxeles según el caso.

## Resultados de las suites

| Comando | Resultado | Tiempo |
| --- | --- | --- |
| `npx playwright test --retries=0` | 124 aprobadas: Chromium escritorio y táctil | 3,1 min |
| `npx playwright test --config=playwright.cross-browser.config.js --retries=0` | 230 aprobadas: Firefox y WebKit escritorio, más WebKit móvil | 5,9 min |

354 ejecuciones aprobadas en las dos suites, sin reintentos. Tras el último ajuste de liberación de documentos se repitió además `npx playwright test --project=desktop tests/e2e/loading.spec.js --retries=0`: 6 aprobadas (5,9 s), incluida la terminación del worker anterior al reabrir el archivo. Comprobación de sintaxis satisfactoria en los 28 módulos/configuraciones JavaScript; `git diff --check` sin incidencias.

## Prueba manual con el documento proporcionado

Documento largo abierto en el navegador local. Edición del título «Resumen operacional» a «Resumen operativo», confirmación, zoom al 160 %, descarga y reapertura mediante la interfaz.

- Fuente Type3 reutilizada; tamaño y origen del texto coinciden con el original.
- El título sustituido ya no figura en el contenido extraíble.
- Detalle visible de 2426 píxeles para aproximadamente 1213 píxeles CSS: densidad 2×.
- Comparación independiente con PyMuPDF a escala 1,5: **0 píxeles cambiados fuera del título**, sobre 6.068.100 píxeles (tolerancia de 2 unidades por canal y margen de 3 puntos alrededor del título).
- Sin errores de consola durante edición, exportación y reapertura.
- El documento personal y sus copias de prueba no están incluidos en el repositorio.

## Límites comprobados y pendientes

- Las fuentes Type3 no tienen un archivo tipográfico utilizable por el navegador: el texto mientras se escribe es aproximado. Tras confirmar, la vista y el PDF exportado emplean los glifos originales.
- Si faltan glifos en la fuente original, la sustitución necesita confirmación. Los caracteres que tampoco puede representar la alternativa bloquean el guardado.
- No se implementa OCR ni redistribución automática de párrafos entre estilos o páginas.
- Imágenes con máscaras, recortes/grupos de mezcla inusuales o superposiciones no aislables pueden seguir siendo incompatibles. No se promete compatibilidad universal con todos los PDFs.
- Se conservan los adjuntos del documento base; no se combinan los adjuntos de documentos añadidos.
- El presupuesto de píxeles limita los lienzos, no toda la memoria del navegador.
- Las pruebas móviles son emulación: Chromium cubre gestos táctiles; WebKit móvil cubre toques, formato, imágenes y guardado. No se han probado dispositivos físicos iOS/Android.
- La edición no conserva la validez de firmas digitales. La apertura con contraseña está cubierta; no se afirma cobertura completa de la exportación cifrada.

Cambios locales, pendientes de revisión y publicación.
