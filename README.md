# Módem Acústico FSK 📡🔊

Proyecto final para la asignatura de **Sistemas de Comunicaciones**
Facultad de Ingeniería, UNAM

## Descripción

Este proyecto implementa un módem acústico web, el cúal transfiere datos (texto) entre dos dispositivos a través del aire usando modulación FSK (Frequency Shift Keying). Resuelve el problema de comunicación en entornos sin red Wi-Fi o emparejamiento Bluetooth, utilizando únicamente la bocina y el micrófono de los equipos.

El sistema utiliza **HTML/JS (Web Audio API)** para la transmisión y recepción de tramas con verificación CRC, y **Python (Jupyter Notebook)** para el análisis estadístico de los resultados.

## Equipo de Desarrollo

* Álvarez Salgado Eduardo Antonio
* Ramírez Rodríguez Oscar Gael
* Yañez Barajas Brandon
* Zúñiga García Hans David

## Estructura del Repositorio

* `/js/`: Lógica del transmisor (Tx) y receptor (Rx) utilizando la transformada de Fourier (FFT) / Algoritmo de Goertzel.
* `/css/`: Estilos de la interfaz web.
* `/colab/`: Notebooks para graficar el porcentaje de mensajes correctos vs. distancia, latencia y velocidad[cite: 5].
* `/reporte/`: Documentación y artículo final.

## Ejecución

El proyecto no requiere instalación. Se ejecuta directamente en el navegador a través de GitHub Pages:
[Abrir Módem FSK](https://tu-usuario.github.io/modem-acustico-fsk)
