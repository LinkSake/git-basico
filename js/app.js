/* ==========================================================
   Tu código tiene memoria: actividades, progreso y guardado
   ========================================================== */
(function () {
  'use strict';

  const CLAVE = 'tcm-progreso-v1';
  const ACTIVIDADES = ['encuesta', 'vr1', 'hotspots', 'clasificacion', 'vr2', 'ordenar', 'mision1', 'vr3', 'mision2', 'vr4', 'tf', 'reto'];

  /* ---------------- Guardado en el navegador ---------------- */
  function cargar() {
    try {
      const datos = JSON.parse(localStorage.getItem(CLAVE));
      if (datos && typeof datos === 'object') return datos;
    } catch (e) { /* almacenamiento no disponible */ }
    return {};
  }
  const estado = Object.assign({ hechas: [], respuestas: {}, encuesta: null, puntos: [], clasificadas: [], misiones: {}, visitadas: [] }, cargar());
  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(estado)); } catch (e) { /* sin guardado: la página sigue funcionando */ }
  }

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------------- Progreso ---------------- */
  function marcar(id) {
    if (!estado.hechas.includes(id)) { estado.hechas.push(id); guardar(); }
    pintarProgreso();
  }
  function pintarProgreso() {
    const n = ACTIVIDADES.filter(a => estado.hechas.includes(a)).length;
    const texto = n + ' de ' + ACTIVIDADES.length + ' actividades';
    $('#progreso-relleno').style.width = (n / ACTIVIDADES.length * 100) + '%';
    $('#progreso-texto').textContent = texto;
    $('#progreso-texto-movil').textContent = texto;
    $$('.actividad[data-actividad]').forEach(el => el.classList.toggle('hecha', estado.hechas.includes(el.dataset.actividad)));
    $$('.seccion').forEach(sec => {
      const acts = (sec.dataset.actividades || '').split(/\s+/).filter(Boolean);
      const completa = acts.length ? acts.every(a => estado.hechas.includes(a)) : estado.visitadas.includes(sec.id);
      const est = $('.estacion[data-seccion="' + sec.id + '"]');
      if (est) est.classList.toggle('completa', completa);
    });
  }

  // Estación actual según la sección visible
  const nombres = {};
  $$('.estacion a').forEach(a => { nombres[a.getAttribute('href').slice(1)] = a.lastChild.textContent.trim(); });
  const observador = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      const id = e.target.id;
      $$('.estacion').forEach(est => est.classList.toggle('actual', est.dataset.seccion === id));
      $('#estacion-actual').textContent = nombres[id] || '';
      if (!estado.visitadas.includes(id)) { estado.visitadas.push(id); guardar(); pintarProgreso(); }
    }
  }, { rootMargin: '-35% 0px -60% 0px' });
  $$('.seccion').forEach(s => observador.observe(s));

  /* ---------------- Encuesta inicial ---------------- */
  (function encuesta() {
    const caja = $('[data-actividad="encuesta"]');
    const retro = $('.retro', caja);
    const elegir = (boton) => {
      $$('.opcion', caja).forEach(b => b.setAttribute('aria-pressed', String(b === boton)));
      retro.textContent = boton.dataset.msg;
      retro.hidden = false;
    };
    $$('.opcion', caja).forEach(b => {
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => { elegir(b); estado.encuesta = b.dataset.op; guardar(); marcar('encuesta'); });
    });
    if (estado.encuesta) { const b = $('.opcion[data-op="' + estado.encuesta + '"]', caja); if (b) elegir(b); }
  })();

  /* ---------------- Cuestionarios (verificaciones y reto) ---------------- */
  function responder(fs, op, desdeGuardado) {
    if (fs.dataset.respondida) return;
    const correcta = fs.dataset.correcta;
    fs.dataset.respondida = op;
    const acierto = op === correcta;
    $$('.opcion', fs).forEach(b => {
      b.disabled = true;
      if (b.dataset.op === correcta) b.classList.add('correcta');
      else if (b.dataset.op === op) b.classList.add('incorrecta');
      if (b.dataset.op === op) b.setAttribute('aria-pressed', 'true');
    });
    const exp = $('.explicacion', fs);
    if (!exp.dataset.original) exp.dataset.original = exp.innerHTML;
    exp.innerHTML = '<span class="veredicto">' + (acierto ? '¡Correcto!' : 'No exactamente.') + '</span> ' + exp.dataset.original;
    exp.classList.toggle('es-correcto', acierto);
    exp.classList.toggle('es-incorrecto', !acierto);
    exp.hidden = false;
    if (!desdeGuardado) { estado.respuestas[fs.dataset.id] = op; guardar(); }
  }
  function reiniciarPregunta(fs) {
    delete fs.dataset.respondida;
    $$('.opcion', fs).forEach(b => { b.disabled = false; b.classList.remove('correcta', 'incorrecta'); b.removeAttribute('aria-pressed'); });
    const exp = $('.explicacion', fs);
    exp.hidden = true;
    delete estado.respuestas[fs.dataset.id];
  }

  $$('.quiz').forEach(quiz => {
    const id = quiz.dataset.actividad;
    const preguntas = $$('.pregunta', quiz);
    const esReto = id === 'reto';
    const revisar = (desdeGuardado) => {
      const respondidas = preguntas.filter(p => p.dataset.respondida).length;
      if (esReto) { $('#reto-respondidas').textContent = respondidas; }
      if (respondidas < preguntas.length) return;
      if (esReto) mostrarResultado(desdeGuardado);
      else marcar(id);
    };
    preguntas.forEach(fs => {
      $$('.opcion', fs).forEach(b => b.addEventListener('click', () => { responder(fs, b.dataset.op); revisar(false); }));
      const previa = estado.respuestas[fs.dataset.id];
      if (previa) responder(fs, previa, true);
    });
    revisar(true);

    function mostrarResultado(desdeGuardado) {
      const caja = $('.reto-resultado', quiz);
      const aciertos = preguntas.filter(p => p.dataset.respondida === p.dataset.correcta).length;
      const logrado = aciertos >= 8;
      caja.hidden = false;
      caja.classList.toggle('logrado', logrado);
      $('.reto-puntaje', caja).textContent = aciertos + ' de 10 aciertos';
      const lista = $('.reto-repaso', caja);
      lista.innerHTML = '';
      if (logrado) {
        $('.reto-mensaje', caja).textContent = '¡Lo lograste! Ya dominas el ciclo básico de Git y sabes dónde vive cada cambio. Tu código ya tiene memoria.';
        $('#reto-reintentar').hidden = true;
        marcar('reto');
      } else {
        $('.reto-mensaje', caja).textContent = 'Vas por buen camino. Te recomendamos repasar estas secciones antes de intentarlo de nuevo:';
        const secciones = [...new Set(preguntas.filter(p => p.dataset.respondida !== p.dataset.correcta).map(p => p.dataset.seccion))];
        const anclas = { 'Sección 2. El modelo mental': '#modelo', 'Sección 3. El ciclo básico': '#ciclo', 'Sección 4. Ramas': '#ramas', 'Sección 5. Trabajo remoto': '#remoto' };
        secciones.sort().forEach(s => { const li = document.createElement('li'); const a = document.createElement('a'); a.href = anclas[s] || '#'; a.textContent = s; li.appendChild(a); lista.appendChild(li); });
        $('#reto-reintentar').hidden = false;
      }
      if (!desdeGuardado) caja.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    }
    if (esReto) {
      $('#reto-reintentar').addEventListener('click', () => {
        preguntas.forEach(reiniciarPregunta);
        guardar();
        $('.reto-resultado', quiz).hidden = true;
        $('#reto-respondidas').textContent = '0';
        preguntas[0].scrollIntoView({ block: 'start' });
        $('.opcion', preguntas[0]).focus({ preventScroll: true });
      });
    }
  });

  /* ---------------- Diagrama con puntos interactivos ---------------- */
  (function puntos() {
    const caja = $('[data-actividad="hotspots"]');
    const botones = $$('[data-punto]', caja);
    const contador = $('#puntos-vistos');
    const mostrar = (clave) => {
      botones.forEach(b => b.setAttribute('aria-expanded', String(b.dataset.punto === clave)));
      $('.punto-vacio', caja).hidden = true;
      $$('[data-texto]', caja).forEach(p => { p.hidden = p.dataset.texto !== clave; });
    };
    const pintarVistos = () => {
      botones.forEach(b => b.classList.toggle('visto', estado.puntos.includes(b.dataset.punto)));
      contador.textContent = estado.puntos.length;
      if (estado.puntos.length === botones.length) marcar('hotspots');
    };
    botones.forEach(b => b.addEventListener('click', () => {
      mostrar(b.dataset.punto);
      if (!estado.puntos.includes(b.dataset.punto)) { estado.puntos.push(b.dataset.punto); guardar(); }
      pintarVistos();
    }));
    pintarVistos();
  })();

  /* ---------------- Clasificación ---------------- */
  (function clasificacion() {
    const caja = $('[data-actividad="clasificacion"]');
    const retro = $('.retro', caja);
    const nombresArea = { trabajo: 'Directorio de trabajo', preparacion: 'Área de preparación', repositorio: 'Repositorio' };
    const tarjetas = $$('.tarjeta', caja);
    const colocar = (tarjeta, animado) => {
      const li = document.createElement('li');
      li.innerHTML = '✓ ' + $('p', tarjeta).innerHTML;
      $('.cajon[data-area="' + tarjeta.dataset.area + '"] ul', caja).appendChild(li);
      tarjeta.remove();
      if (!animado) return;
    };
    const decir = (texto, ok) => {
      retro.innerHTML = '<span class="veredicto">' + (ok ? '¡Correcto!' : 'No exactamente.') + '</span> ' + texto;
      retro.className = 'retro ' + (ok ? 'es-correcto' : 'es-incorrecto');
      retro.hidden = false;
    };
    const elegir = (tarjeta, area) => {
      if (!tarjeta.isConnected) return;
      if (area === tarjeta.dataset.area) {
        decir(tarjeta.dataset.retro.replace(/git (add|commit|log)/g, '<code>git $1</code>'), true);
        estado.clasificadas.push(tarjeta.dataset.id); guardar();
        colocar(tarjeta, true);
        if (!$('.tarjeta', caja)) marcar('clasificacion');
        else $('.tarjeta button', caja).focus({ preventScroll: true });
      } else {
        decir('Esta situación no va en ' + nombresArea[area] + '. Recuerda: solo <code>git add</code> lleva cambios al área de preparación y solo <code>git commit</code> los guarda en el repositorio. Inténtalo de nuevo.', false);
        tarjeta.classList.remove('error'); void tarjeta.offsetWidth; tarjeta.classList.add('error');
      }
    };
    tarjetas.forEach(t => {
      const botones = document.createElement('div');
      botones.className = 'tarjeta-botones';
      botones.setAttribute('role', 'group');
      botones.setAttribute('aria-label', 'Elige el área');
      for (const area of Object.keys(nombresArea)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = nombresArea[area];
        b.addEventListener('click', () => elegir(t, area));
        botones.appendChild(b);
      }
      t.appendChild(botones);
      t.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', t.dataset.id); e.dataTransfer.effectAllowed = 'move'; t.classList.add('arrastrando'); });
      t.addEventListener('dragend', () => t.classList.remove('arrastrando'));
      if (estado.clasificadas.includes(t.dataset.id)) colocar(t, false);
    });
    $$('.cajon', caja).forEach(cajon => {
      cajon.addEventListener('dragover', (e) => { e.preventDefault(); cajon.classList.add('sobre'); });
      cajon.addEventListener('dragleave', () => cajon.classList.remove('sobre'));
      cajon.addEventListener('drop', (e) => {
        e.preventDefault(); cajon.classList.remove('sobre');
        const t = $('.tarjeta[data-id="' + e.dataTransfer.getData('text/plain') + '"]', caja);
        if (t) elegir(t, cajon.dataset.area);
      });
    });
    if (!$('.tarjeta', caja)) marcar('clasificacion');
  })();

  /* ---------------- Ordenar los pasos ---------------- */
  (function ordenarPasos() {
    const caja = $('[data-actividad="ordenar"]');
    const lista = $('.ordenable', caja);
    const retro = $('.retro', caja);
    const boton = $('#revisar-orden');
    const limpiar = () => { $$('li', lista).forEach(li => li.classList.remove('marcado')); };
    const resolver = () => {
      $$('li', lista).sort((a, b) => a.dataset.orden - b.dataset.orden).forEach(li => { li.draggable = false; lista.appendChild(li); });
      lista.classList.add('resuelto');
      boton.hidden = true;
    };
    lista.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || lista.classList.contains('resuelto')) return;
      const li = b.closest('li');
      limpiar();
      if (b.classList.contains('subir') && li.previousElementSibling) lista.insertBefore(li, li.previousElementSibling);
      else if (b.classList.contains('bajar') && li.nextElementSibling) lista.insertBefore(li.nextElementSibling, li);
      b.focus();
    });
    let arrastrado = null;
    lista.addEventListener('dragstart', (e) => { arrastrado = e.target.closest('li'); if (!arrastrado) return; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); arrastrado.classList.add('arrastrando'); limpiar(); });
    lista.addEventListener('dragend', () => { if (arrastrado) arrastrado.classList.remove('arrastrando'); arrastrado = null; });
    lista.addEventListener('dragover', (e) => {
      if (!arrastrado) return;
      e.preventDefault();
      const otros = $$('li:not(.arrastrando)', lista);
      const siguiente = otros.find(li => { const r = li.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (siguiente) lista.insertBefore(arrastrado, siguiente); else lista.appendChild(arrastrado);
    });
    boton.addEventListener('click', () => {
      limpiar();
      const items = $$('li', lista);
      const mal = items.findIndex((li, i) => Number(li.dataset.orden) !== i + 1);
      if (mal === -1) {
        retro.innerHTML = '<span class="veredicto">¡Ese es el ciclo!</span> Después del primer <em>commit</em> se repite una y otra vez: editas, revisas, preparas, confirmas.';
        retro.className = 'retro es-correcto';
        retro.hidden = false;
        resolver();
        marcar('ordenar');
        return;
      }
      const orden = items.map(li => Number(li.dataset.orden));
      items[mal].classList.add('marcado');
      let pista = 'El paso marcado está fuera de lugar. Piensa qué necesitas tener listo antes de poder hacerlo.';
      if (orden.indexOf(4) > orden.indexOf(5)) pista = 'Recuerda: solo se puede fotografiar lo que ya está en el encuadre. Revisa el orden de <code>git add</code> y <code>git commit</code>.';
      else if (orden.indexOf(1) !== 0) pista = 'Antes de cualquier otro comando, la carpeta tiene que convertirse en repositorio.';
      else if (orden.indexOf(6) !== 5) pista = 'Para revisar el historial primero tiene que existir al menos una fotografía.';
      retro.innerHTML = '<span class="veredicto">Todavía no.</span> ' + pista;
      retro.className = 'retro es-incorrecto';
      retro.hidden = false;
    });
    if (estado.hechas.includes('ordenar')) { resolver(); retro.innerHTML = '<span class="veredicto">¡Ese es el ciclo!</span> Después del primer <em>commit</em> se repite una y otra vez: editas, revisas, preparas, confirmas.'; retro.className = 'retro es-correcto'; retro.hidden = false; }
  })();

  /* ---------------- Recorrido animado de la Sección 3 ---------------- */
  (function recorrido() {
    const tarjeta = $('#tarjeta-recorrido');
    const estadoTxt = $('#recorrido-estado'), texto = $('#recorrido-texto');
    const bAdd = $('#recorrido-add'), bCommit = $('#recorrido-commit');
    const pasos = [
      ['modificado', 'El archivo está modificado en tu directorio de trabajo.'],
      ['preparado', 'git add lo llevó al área de preparación: entrará en la próxima fotografía.'],
      ['confirmado', 'git commit lo guardó en el repositorio. La fotografía ya está en el álbum.']
    ];
    const ir = (n) => {
      tarjeta.dataset.paso = n;
      estadoTxt.textContent = pasos[n][0];
      texto.textContent = pasos[n][1];
      bAdd.disabled = n !== 0;
      bCommit.disabled = n !== 1;
    };
    bAdd.addEventListener('click', () => { ir(1); bCommit.focus(); });
    bCommit.addEventListener('click', () => { ir(2); $('#recorrido-reiniciar').focus(); });
    $('#recorrido-reiniciar').addEventListener('click', () => { ir(0); bAdd.focus(); });
    ir(0);
  })();

  /* ---------------- Simuladores ---------------- */
  $$('.simulador').forEach(el => {
    const n = el.dataset.mision;
    window.Simulador.montar(el, {
      historial: estado.misiones[n] || [],
      guardar(h) { estado.misiones[n] = h; guardar(); },
      alCompletar() { marcar('mision' + n); }
    });
  });

  /* ---------------- Guía imprimible ---------------- */
  $('#imprimir-guia').addEventListener('click', () => {
    document.body.classList.add('imprimir-guia');
    window.print();
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('imprimir-guia'));

  /* ---------------- Reiniciar todo ---------------- */
  $('#reiniciar-todo').addEventListener('click', () => {
    if (!confirm('¿Borrar tu progreso? Se reiniciarán todas las actividades y las misiones.')) return;
    try { localStorage.removeItem(CLAVE); } catch (e) { /* nada que borrar */ }
    location.hash = '';
    location.reload();
  });

  pintarProgreso();
})();
