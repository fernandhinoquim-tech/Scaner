# Librerías incluidas (vendor)

La app no carga código de servidores de terceros: el lector de texto (Tesseract.js) y el lector
de PDF (pdf.js) están copiados aquí, sin modificar, desde los paquetes oficiales de npm. Antes de
copiarlos se comprobó que cada paquete coincide con la huella (SHA-512) publicada por el registro
de npm:

| Paquete | Versión | Integridad publicada en npm |
|---|---|---|
| tesseract.js | 7.0.0 | sha512-exPBkd+z+wM1BuMkx/Bjv43OeLBxhL5kKWsz/9JY+DXcXdiBjiAch0V49QR3oAJqCaL5qURE0vx9Eo+G5YE7mA== |
| tesseract.js-core | 7.0.0 | sha512-WnNH518NzmbSq9zgTPeoF8c+xmilS8rFIl1YKbk/ptuuc7p6cLNELNuPAzcmsYw450ca6bLa8j3t0VAtq435Vw== |
| @tesseract.js-data/spa | 1.0.0 | sha512-9Ln+QKq/TNu4Hy4aOp5b4nXo9U0C6IqJMzNDpAJZe/fNtz6jXG9G/hQgR/Irxj+RGf0M7Xy1MNx1yl4wQUIfeg== |
| @tesseract.js-data/eng | 1.0.0 | sha512-mbTumm6KQPUHyzTPQaF3ObXYnx0SqqfV2nabqFVQBwD6Kl7PhGSLSzOlfFTWy0P3BjghaSKA2W9GB19Jk+ZcTg== |
| pdfjs-dist | 6.4.299 | sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g== |

Qué se copió de cada uno:

- `tesseract-7.0.0/`: `dist/tesseract.min.js` y `dist/worker.min.js` (tesseract.js); en `core/`, los
  tres motores LSTM (`tesseract-core-*lstm.wasm.js`: normal, SIMD y SIMD relajado; el teléfono usa
  el que soporte); en `lang/`, los datos de español e inglés `4.0.0_best_int`.
- `pdfjs-6.4.299/`: `legacy/build/pdf.min.mjs` y `pdf.worker.min.mjs` (renombrados a `.js` para que
  cualquier servidor los entregue como JavaScript), y las carpetas `cmaps/`, `standard_fonts/`,
  `iccs/` y `wasm/` (sin el motor de scripts `quickjs-eval`, porque la app nunca ejecuta scripts de
  los PDF).

Licencias: tesseract.js y tesseract.js-core, Apache-2.0 (`LICENSE-tesseract.js.md`,
`core/LICENSE`); datos de idioma de Tesseract (Google, Apache-2.0; paquete npm MIT); pdf.js,
Apache-2.0 (`LICENSE`), y sus módulos en `wasm/` con sus propias licencias (`LICENSE_*`).

El service worker (`sw.js`, `VENDOR_SHA256`) comprueba la huella SHA-256 de cada archivo de código
(`.js` y `.wasm`) antes de guardarlo y cada vez que lo entrega: si no coincide, no se usa. Así, ni una
copia alterada en el servidor ni una guardada en el teléfono pueden ejecutarse.

Para actualizar una librería: copiar la nueva versión en una carpeta con su número de versión
(por ejemplo `pdfjs-7.0.0/`), cambiar la ruta en `js/ocr.js` o `js/pdfimport.js`, el patrón
`VENDOR_CURRENT` y las huellas `VENDOR_SHA256` de `sw.js` (SHA-256 en base64 de cada `.js`/`.wasm`),
y borrar la carpeta vieja.

## Huellas SHA-256 de los archivos principales

```
0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594  pdfjs-6.4.299/LICENSE
73e1ba37d2bad5bab2a964f40a9eed96209666efc067c3322626214bbef234a0  pdfjs-6.4.299/iccs/CGATS001Compat-v2-micro.icc
286e4fd7b447330b2c88e23890e3cd0a9d38cb398d4a59cb247f578ccbda3213  pdfjs-6.4.299/iccs/LICENSE
bccc24ea711db8e44503629519904a5292d73b9daaa214bbe7cdcc282b0f4259  pdfjs-6.4.299/pdf.min.js
145d2dd3ab0c86151011dba95acfa2d5336e2accd59388ea43dbee0efddaaec6  pdfjs-6.4.299/pdf.worker.min.js
9e66b7f1b934a28b37f3bc4dac97915de1674271e79a0a88182a18ed9731b4d1  pdfjs-6.4.299/wasm/LICENSE_JBIG2
a6af136f3e15038a666b61f376612a07d9a4e48cb7c01adbf3e33b3f14ab49b6  pdfjs-6.4.299/wasm/LICENSE_OPENJPEG
aad3cce09842e00e9e11ad5e8fef8cc02fbc3a3768fe2f007443b9cee37aaee5  pdfjs-6.4.299/wasm/LICENSE_PDFJS_JBIG2
717fc62da03292dbb4dd0c8280bd4ce7bb8550dcf31d772bc93455fb50313425  pdfjs-6.4.299/wasm/LICENSE_PDFJS_OPENJPEG
508a77d2e7b51d98adeed32648ad124b7b30241a8e70b2e72c99f92d8e5874d1  pdfjs-6.4.299/wasm/LICENSE_PDFJS_QCMS
36d847ae882f6574ebc72f56a4f354e4f104fde4a584373496482e97d52d31bc  pdfjs-6.4.299/wasm/LICENSE_QCMS
466f45c2a61a698152fb5400c27e56ff2ceb73dcb71fde3fc366a502308eaab0  pdfjs-6.4.299/wasm/jbig2.wasm
68686ced624a48c42f84cdaa482ec44b72b0de4dc84a0df903af1fb7b45b5d9a  pdfjs-6.4.299/wasm/jbig2_nowasm_fallback.js
95e5002597af0824004aa57b1900fe019715db389e37640b1e58395e42f00cc5  pdfjs-6.4.299/wasm/openjpeg.wasm
9047b34b6bc142d85e4b0aa1b08b0b9baad4c6f8b7ac87641b9e8f90eb6fd23e  pdfjs-6.4.299/wasm/openjpeg_nowasm_fallback.js
663d86126d5f5fcb1c61490f94353e2a8375660b8c5498ab3ebab5a34b08800e  pdfjs-6.4.299/wasm/qcms_bg.wasm
b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1  tesseract-7.0.0/LICENSE-tesseract.js.md
c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08  tesseract-7.0.0/core/LICENSE
eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680  tesseract-7.0.0/core/tesseract-core-lstm.wasm.js
861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3  tesseract-7.0.0/core/tesseract-core-relaxedsimd-lstm.wasm.js
c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38  tesseract-7.0.0/core/tesseract-core-simd-lstm.wasm.js
45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91  tesseract-7.0.0/lang/eng.traineddata.gz
40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb  tesseract-7.0.0/lang/spa.traineddata.gz
000c27d9cd0def655f77b36c72a389c0ab13793aa31cb4d7aab56d09c0afbc7e  tesseract-7.0.0/tesseract.min.js
576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d  tesseract-7.0.0/worker.min.js
```
