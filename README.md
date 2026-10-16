# Scaner – Escáner de documentos para el celular

App web instalable (PWA) para escanear documentos con la cámara del teléfono.
No necesita tienda de apps ni PC: se abre en el navegador del celular y se instala
en la pantalla de inicio como cualquier app.

## Qué hace

- **Rápida**: abre la cámara, detecta la hoja en vivo (contorno azul) y con un toque
  la recorta, endereza y mejora automáticamente. Puedes seguir tomando páginas sin salir de la cámara.
  La detección busca los bordes rectos de la hoja (también por diferencias de color), así que funciona
  con sombras y sobre mesas claras. Si la hoja y la mesa son del mismo blanco, la app avisa y puedes
  ajustar las esquinas después.
- **Disparo automático** (botón *Auto*): toma la foto sola cuando la hoja está quieta.
  Ideal para escanear muchas hojas seguidas.
- **Modo cédula**: en la cámara elige *Cédula*, toma el frente y el reverso de la tarjeta (cédula,
  licencia, carné) y quedan juntos en una hoja carta, a **tamaño real** o **ampliada al 150 %**.
- **Ilimitado**: sin límite de páginas ni de documentos. Todo se guarda en el propio
  teléfono (nada se sube a internet).
- **Filtros**: Documento (quita sombras y tintes de luz de color, fondo blanco, conserva fotos y colores), Color, Gris, Blanco y negro, Original.
- **Edición**: ajustar esquinas con lupa, girar, borrar páginas, renombrar documentos.
- **Ordenar páginas**: mantén presionada una página y arrástrala a su nuevo lugar.
- **Importar PDF e imágenes**: con *Importar* o *+ Archivos* puedes subir fotos o documentos PDF;
  cada página del PDF queda como una página más del documento (y se puede leer su texto con OCR).
  Los archivos de Word hay que guardarlos primero como PDF (en Word: *Archivo → Guardar como → PDF*).
  La primera vez que se importa un PDF se descarga el lector de PDF (unos 2 MB).
- **Insertar páginas en medio**: el botón **＋** de cada página abre *Insertar después de la
  página N*: puedes tomar fotos o subir imágenes/PDF y quedan justo en ese lugar.
  Si el PDF tiene contraseña, la app la pide.
- **Unir documentos y mover páginas** (menú ⋮ del documento): *Unir otro documento a este*, o
  *Seleccionar páginas* para pasarlas a otro documento (o a uno nuevo) o eliminar varias a la vez.
- **Buscar** en la pantalla principal por el nombre o por el **texto de adentro** de tus documentos
  (sin importar tildes ni mayúsculas): muestra el fragmento encontrado y abre la página.
- **Nombre automático**: un documento nuevo se nombra solo con el título de su primera página
  (o con el nombre del PDF importado). Se puede cambiar tocando el nombre.
- **Enderezar solas** las páginas que quedaron de lado o al revés (salvo que las hayas girado a mano).
- **Firmar**: en una página toca *Firmar*, dibuja tu firma con el dedo o usa una **foto de tu firma
  en papel** (la app separa la tinta del papel). Se mueve y se agranda con el dedo, y queda guardada
  para la próxima vez.
- **Copiar el texto** de una página o de todo el documento (*Texto* en el editor, o menú ⋮) para
  pegarlo en WhatsApp o un correo; se puede corregir antes de copiar.
- **Formatos de salida**:
  - **PDF** (una o varias páginas; hoja Automática, Carta, A4 u Oficio), con **texto buscable**
    opcional: el PDF se ve igual que el escaneo, pero puedes buscar, seleccionar y copiar palabras.
    También se puede **proteger con contraseña** (cifrado AES de 256 bits, el estándar actual que abren
    Adobe, Chrome, Android, iPhone y Windows). La contraseña no se guarda en la app.
  - **JPG**, **PNG**, **WEBP** (varias páginas se descargan juntas en un `.zip`)
  - **Word (.docx)** y **TXT** con el texto reconocido (OCR en español e inglés).
    En Android, Chrome no deja compartir Word directamente: se guarda en Descargas y se envía desde ahí.
  - Calidad alta, media o baja (para enviar por WhatsApp o correo)
- **Compartir** directo a WhatsApp, correo, Drive, etc., o **Descargar** al teléfono.
- Funciona **sin conexión** después de abrirla la primera vez
  (el OCR necesita internet solo la primera vez, para descargar el lector de texto: unos 9 MB).

## Lectura de texto (OCR)

- Usa [Tesseract.js](https://github.com/naptha/tesseract.js) 7 con español + inglés, dentro del
  teléfono: tus documentos no se envían a ningún servidor.
- Antes de leer, la app prepara una imagen especial a la máxima resolución disponible: gris,
  con la iluminación aplanada (quita sombras) y el blanco del papel ajustado según el ruido de
  cada zona. En fotos de prueba generadas por computadora (con sombras, desenfoque y poca luz),
  esto bajó los errores de lectura de ~6,8 % a ~0,1 % de los caracteres.
- Detecta páginas **de lado o al revés** y las lee en el sentido correcto (y te avisa para que
  puedas enderezarlas).
- **Lectura automática**: después de escanear, la app lee el texto en segundo plano (para buscar,
  poner nombre y enderezar). Se pausa con la cámara abierta, al exportar y con la app cerrada, y se
  puede desactivar en la pantalla principal. Sin internet, espera a tenerlo la primera vez.
- El texto leído se guarda con cada página: volver a exportar en PDF, TXT o Word es instantáneo.
  Solo se vuelve a leer una página si cambias su recorte o la giras.
- Puedes **detener** la lectura en cualquier momento. Si no hay internet la primera vez, el PDF
  se guarda igual (sin texto buscable) y la app lo avisa.
- Límites: la letra a mano y las tablas complejas se leen mal; el texto se copia en el orden de
  los renglones, sin el formato original.

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
js/imgproc.js         Detección de bordes, corrección de perspectiva, filtros y preparación para OCR
js/worker.js          Procesa las imágenes en segundo plano
js/ocr.js             Lector de texto (Tesseract.js): carga, lectura, cancelación
js/pdfimport.js       Importación de PDF (pdf.js): convierte cada página en imagen
js/pdfcrypt.js        Cifrado del PDF con contraseña (AES-256, WebCrypto)
js/text.js            Título automático y búsqueda por texto
js/sign.js            Firmas: dibujar, extraer de una foto y estampar en la página
js/idcard.js          Modo cédula: frente y reverso en una hoja
js/export.js          Generación de PDF (con capa de texto), ZIP, DOCX y TXT
js/db.js              Almacenamiento local (IndexedDB)
sw.js                 Funcionamiento sin conexión
manifest.webmanifest  Datos para instalar la app
```

No usa librerías ni proceso de compilación; el PDF (incluidos su capa de texto y su cifrado) y el
ZIP se generan con código propio. El OCR usa Tesseract.js y la importación de PDF usa pdf.js; ambos se descargan
solo al usarlos.
