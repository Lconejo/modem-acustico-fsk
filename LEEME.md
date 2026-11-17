# Módem acústico FSK — proyecto de Sistemas de Comunicaciones

Aplicación de comunicaciones · Ingeniería en Computación · Facultad de Ingeniería

## Qué hay en el paquete

| Carpeta / archivo | Qué es |
| --- | --- |
| `app/dist/modem_acustico.html` | La aplicación completa en un solo archivo. Ábrela en Chrome. |
| `app/src/modem.js` | Núcleo del módem: trama, modulador FSK con salto, receptor Goertzel, canal simulado. |
| `app/src/app.html` | Interfaz (tablero animado, espectrograma, detector, pruebas). |
| `app/build.py` | Une `modem.js` + `app.html` + resultados de referencia en `dist/modem_acustico.html`. |
| `app/test/test_modem.js` | Pruebas del módem en Node.js (`node test/test_modem.js`). |
| `app/test/reference.js` | Genera los resultados de referencia (`node test/reference.js > dist/reference.json`). |
| `app/test/e2e.js` | Prueba en Chromium con micrófono virtual (requiere Playwright). |
| `notebook/modem_acustico_validacion.ipynb` | Cuaderno de Google Colab: validación en Python y análisis de la prueba física. |
| `articulo/articulo_modem_acustico.tex` y `.pdf` | Reporte en formato de artículo (LaTeX) con sus figuras. |

## Cómo usar la app

- **Transmitir:** sirve en cualquier navegador, incluido el enlace publicado y el celular.
- **Recibir con micrófono:** abre `modem_acustico.html` en Chrome de la computadora (doble clic) y permite el micrófono.
  En celular el micrófono solo funciona si la página se abre desde `https`. Para eso, súbanla a GitHub Pages:
  crear un repositorio, subir `modem_acustico.html` como `index.html`, y en *Settings → Pages* elegir la rama `main`.
- Los dos equipos deben tener la **misma configuración** de tonos y velocidad (por omisión: salto de frecuencia, 100 bit/s).
- Si el micrófono está bloqueado, graben la transmisión con la grabadora del celular y usen **Recibir → Analizar una grabación**.

## Prueba física (llena la Tabla 6 del artículo)

1. Laptop (receptor): pestaña **Recibir** → *Activar micrófono* → escribir distancia y condición → *Iniciar serie*.
2. Celular (transmisor), volumen al máximo: pestaña **Transmitir** → *Enviar ráfaga* (20 tramas, unos 80 s).
3. Laptop: *Terminar serie*. Repetir a 0.5, 1, 2 y 3 m en silencio, y a 1 m con ruido de fondo.
4. *Descargar CSV por trama* → subirlo al cuaderno de Colab (sección 7), que hace las gráficas `prueba_fisica`.
5. Copiar los valores de la tabla de series a la Tabla 6 del artículo y la fila "Alcance" de la Tabla 7.

## Pendiente antes de entregar

- [ ] Nombres de los integrantes en `\Integrantes` (línea 30 del `.tex`).
- [ ] Tabla 6 (prueba física) y fila "Alcance" de la Tabla 7; quitar las marcas rojas.
- [ ] Opcional: agregar la figura `figs/prueba_fisica.pdf` que genera el cuaderno.
- [ ] Grabar el video con el guion y subirlo.
