# Tu código tiene memoria

Experiencia educativa digital: introducción al control de versiones con Git para estudiantes universitarios que inician en el desarrollo de software.

Página estática hecha con HTML, CSS y JavaScript, sin frameworks ni dependencias. Incluye un simulador de terminal de Git con dos misiones guiadas, actividades interactivas con retroalimentación inmediata y un reto final.

## Estructura

```
index.html        Contenido de la experiencia (secciones 0 a 8)
css/estilos.css   Estilos, modo oscuro y versión imprimible de la guía rápida
js/simulador.js   Simulador de Git y misiones
js/app.js         Actividades, progreso y guardado en el navegador
img/icono.svg     Ícono de la pestaña
```

## Publicar en GitHub Pages

1. Crea un repositorio público en GitHub (por ejemplo, `tu-codigo-tiene-memoria`).
2. Sube estos archivos a la rama `main`:
   ```
   git init
   git add .
   git commit -m "Publica experiencia educativa sobre Git"
   git branch -M main
   git remote add origin https://github.com/<tu-usuario>/tu-codigo-tiene-memoria.git
   git push -u origin main
   ```
3. En el repositorio, entra a **Settings → Pages**. En **Build and deployment**, elige **Deploy from a branch**, la rama `main` y la carpeta `/ (root)`. Guarda.
4. En uno o dos minutos la página quedará en `https://<tu-usuario>.github.io/tu-codigo-tiene-memoria/`.

## Probar en tu computadora

Desde esta carpeta:

```
python3 -m http.server 8000
```

y abre `http://localhost:8000`.

## Créditos

Diseño y desarrollo: Luis Ángel Ortega Holguín, 2026. Ilustraciones: elaboración propia. Video incrustado: Platzi (2019). Contenido conceptual basado en *Pro Git* (Chacon y Straub, 2014).
