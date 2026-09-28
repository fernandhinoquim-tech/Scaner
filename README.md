# Scaner – Escáner de documentos para el celular

App web instalable (PWA) para escanear documentos con la cámara del teléfono.
No necesita tienda de apps ni PC: se abre en el navegador del celular y se instala
en la pantalla de inicio como cualquier app.

## Qué hace

- **Rápida**: abre la cámara, detecta la hoja en vivo (contorno azul) y con un toque
  la recorta, endereza y mejora automáticamente. Puedes seguir tomando páginas sin salir de la cámara.
- **Disparo automático** (botón *Auto*): toma la foto sola cuando la hoja está quieta.
  Ideal para escanear muchas hojas seguidas.
- **Ilimitado**: sin límite de páginas ni de documentos. Todo se guarda en el propio
  teléfono (nada se sube a internet).
- **Filtros**: Documento (quita sombras, fondo blanco), Color, Gris, Blanco y negro, Original.
- **Edición**: ajustar esquinas con lupa, girar, reordenar y borrar páginas, renombrar documentos.
- **Formatos de salida**:
  - **PDF** (una o varias páginas; hoja Automática, Carta, A4 u Oficio)
  - **JPG**, **PNG**, **WEBP** (varias páginas se descargan juntas en un `.zip`)
  - **Word (.docx)** y **TXT** con el texto reconocido (OCR en español e inglés)
  - Calidad alta, media o baja (para enviar por WhatsApp o correo)
- **Compartir** directo a WhatsApp, correo, Drive, etc., o **Descargar** al teléfono.
- Funciona **sin conexión** después de abrirla la primera vez
  (el OCR necesita internet solo la primera vez, para descargar el lector de texto).

## Cómo publicarla (desde el celular, sin PC)

1. En GitHub abre el repositorio → **Settings** → **Pages**.
2. En *Build and deployment* → *Source* elige **Deploy from a branch**.
3. Elige la rama (por ejemplo `main`, o `claude/document-scanner-app-0svlnn`) y la carpeta **/ (root)** → **Save**.
4. En 1–2 minutos la app queda en: `https://fernandhinoquim-tech.github.io/Scaner/`

## Cómo instalarla en el teléfono

- **Android (Chrome)**: abre el enlace → botón **Instalar app** (o menú ⋮ → *Instalar aplicación*).
  Manteniendo presionado el ícono aparece el atajo **Escanear** que abre directo la cámara.
- **iPhone (Safari)**: abre el enlace → botón *Compartir* → **Agregar a pantalla de inicio**.

Consejo: activa **"Abrir la cámara al iniciar la app"** en la pantalla principal para que
al tocar el ícono ya estés listo para escanear.

## Estructura

```
index.html            Pantallas de la app
css/styles.css        Estilos (modo claro/oscuro)
js/app.js             Lógica de pantallas, cámara, edición y exportación
js/imgproc.js         Detección de bordes, corrección de perspectiva y filtros
js/worker.js          Procesa las imágenes en segundo plano
js/export.js          Generación de PDF, ZIP, DOCX, TXT y OCR
js/db.js              Almacenamiento local (IndexedDB)
sw.js                 Funcionamiento sin conexión
manifest.webmanifest  Datos para instalar la app
```

No usa librerías ni proceso de compilación; el PDF y el ZIP se generan con código propio.
El OCR usa [Tesseract.js](https://github.com/naptha/tesseract.js), que se descarga solo al usarlo.
