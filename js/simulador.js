/* ==========================================================
   Simulador de Git (subconjunto educativo)
   Modela directorio de trabajo, área de preparación,
   commits como instantáneas, ramas, HEAD y fusiones.
   Los mensajes se basan en la traducción de Git al español.
   ========================================================== */
(function () {
  'use strict';

  /* ---------------- Utilidades ---------------- */
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  function hashLargo(semilla) {
    let s = '';
    for (let i = 0; i < 5; i++) s += fnv(semilla + '#' + i);
    return s;
  }
  function ordenar(arr) { return arr.slice().sort((a, b) => a.localeCompare(b)); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // Separa una línea en palabras respetando comillas (incluye comillas tipográficas de teclados móviles)
  function tokens(linea) {
    const out = [];
    let actual = '', cierres = null, hay = false;
    const dobles = ['"', '“', '”', '«', '»'], simples = ["'", '‘', '’'];
    for (const ch of linea) {
      if (cierres) {
        if (cierres.includes(ch)) cierres = null;
        else actual += ch;
      } else if (dobles.includes(ch)) { cierres = dobles; hay = true; }
      else if (simples.includes(ch)) { cierres = simples; hay = true; }
      else if (/\s/.test(ch)) { if (actual || hay) { out.push(actual); actual = ''; hay = false; } }
      else { actual += ch; hay = true; }
    }
    if (actual || hay) out.push(actual);
    return out;
  }

  function distancia(a, b) {
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i].concat(Array(n).fill(0)));
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[m][n];
  }

  const SUBCOMANDOS = ['init', 'status', 'add', 'commit', 'log', 'branch', 'switch', 'checkout', 'merge', 'restore', 'reset', 'rm', 'config', 'clone', 'push', 'pull', 'remote', 'fetch', 'diff', 'stash', 'help', 'version'];
  const MENSAJES_VAGOS = ['cambios', 'cambio', 'x', 'xx', 'asdf', 'fix', 'ya', 'ya quedó', 'ya quedo', 'listo', 'update', 'updates', 'prueba', 'test', 'commit', 'arreglos', 'wip', 'algo', 'a', '.', '...'];
  const FECHA = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  /* ---------------- Modelo del repositorio ---------------- */
  class Repo {
    constructor(archivos) {
      this.trabajo = Object.assign({}, archivos);
      this.iniciado = false;
      this.indice = {};
      this.commits = {};
      this.orden = [];
      this.ramas = {};
      this.carril = {};
      this.head = 'main';
      this.n = 0;
    }
    punta(rama) { const r = rama || this.head; return this.ramas[r] || null; }
    arbol(h) { return h ? this.commits[h].arbol : {}; }
    arbolHead() { return this.arbol(this.punta()); }

    preparados() {
      const ah = this.arbolHead(), ix = this.indice, out = [];
      const nombres = ordenar([...new Set([...Object.keys(ah), ...Object.keys(ix)])]);
      for (const f of nombres) {
        if (!(f in ah)) out.push({ f, tipo: 'nuevo' });
        else if (!(f in ix)) out.push({ f, tipo: 'eliminado' });
        else if (ah[f] !== ix[f]) out.push({ f, tipo: 'modificado' });
      }
      return out;
    }
    noPreparados() {
      const out = [];
      for (const f of ordenar(Object.keys(this.indice))) {
        if (!(f in this.trabajo)) out.push({ f, tipo: 'eliminado' });
        else if (this.trabajo[f] !== this.indice[f]) out.push({ f, tipo: 'modificado' });
      }
      return out;
    }
    sinSeguimiento() { return ordenar(Object.keys(this.trabajo).filter(f => !(f in this.indice))); }
    hayCambiosLocales() { return this.preparados().length > 0 || this.noPreparados().length > 0; }

    ancestros(h) {
      const vistos = new Set(), pila = h ? [h] : [];
      while (pila.length) {
        const x = pila.pop();
        if (vistos.has(x)) continue;
        vistos.add(x);
        pila.push(...this.commits[x].padres);
      }
      return vistos;
    }
    esAncestro(a, b) { return this.ancestros(b).has(a); }
    baseFusion(a, b) {
      const A = this.ancestros(a), B = this.ancestros(b);
      let mejor = null;
      for (const h of A) if (B.has(h) && (!mejor || this.commits[h].n > this.commits[mejor].n)) mejor = h;
      return mejor;
    }
    crearCommit(mensaje, padres, arbol) {
      this.n += 1;
      const largo = hashLargo(this.n + '|' + mensaje + '|' + padres.join(',') + '|' + JSON.stringify(arbol));
      const h = largo.slice(0, 7);
      this.commits[h] = { h, largo, mensaje, padres, arbol: Object.assign({}, arbol), n: this.n, carril: this.carril[this.head] || 0, fecha: new Date() };
      this.orden.push(h);
      this.ramas[this.head] = h;
      return h;
    }
    // Lleva el directorio de trabajo y el índice al árbol de destino conservando cambios locales compatibles
    aplicarArbol(destino) {
      const actual = this.arbolHead();
      const modificadosLocal = new Set();
      for (const f of Object.keys(actual)) {
        if (this.trabajo[f] !== actual[f] || this.indice[f] !== actual[f]) modificadosLocal.add(f);
      }
      const desaparecen = [], aparecen = [];
      for (const f of Object.keys(actual)) {
        if (modificadosLocal.has(f)) continue;
        if (!(f in destino)) { delete this.trabajo[f]; delete this.indice[f]; desaparecen.push(f); }
      }
      for (const f of Object.keys(destino)) {
        if (modificadosLocal.has(f)) continue;
        if (!(f in actual)) aparecen.push(f);
        this.trabajo[f] = destino[f];
        this.indice[f] = destino[f];
      }
      return { desaparecen, aparecen };
    }
    conflictosAlCambiar(destino) {
      const actual = this.arbolHead(), out = [];
      for (const f of new Set([...Object.keys(actual), ...Object.keys(this.indice), ...Object.keys(this.trabajo)])) {
        const local = (this.trabajo[f] !== actual[f] || this.indice[f] !== actual[f]) && (f in this.indice || f in actual);
        if (local && destino[f] !== actual[f]) out.push(f);
      }
      return ordenar(out);
    }
    decoraciones(h) {
      const refs = [];
      for (const r of ordenar(Object.keys(this.ramas))) {
        if (this.ramas[r] === h) refs.push(r);
      }
      if (!refs.length) return '';
      const partes = [];
      if (refs.includes(this.head)) partes.push('HEAD -> ' + this.head);
      for (const r of refs) if (r !== this.head) partes.push(r);
      return '(' + partes.join(', ') + ')';
    }
  }

  /* ---------------- Ejecución de comandos ---------------- */
  // Cada comando devuelve { lineas: [{t, c}], tipo, explica, destacado }
  function L(t, c) { return { t, c: c || '' }; }

  function ayuda() {
    return {
      tipo: 'ayuda',
      lineas: [
        L('Comandos disponibles en este simulador:', 'amarillo'),
        L('  git init                  crear un repositorio'),
        L('  git status                ver el estado de los archivos'),
        L('  git add <archivo> | .     preparar cambios'),
        L('  git commit -m "mensaje"   confirmar lo preparado'),
        L('  git log [--oneline] [--graph]   ver el historial'),
        L('  git branch [<nombre>]     listar o crear ramas'),
        L('  git branch -d <nombre>    borrar una rama fusionada'),
        L('  git switch [-c] <rama>    cambiar de rama (o crearla)'),
        L('  git merge <rama>          fusionar una rama en la actual'),
        L('  git restore --staged <archivo>  sacar un archivo del área de preparación'),
        L('  ls                        ver los archivos de la carpeta'),
        L('  limpiar                   limpiar la pantalla'),
        L('Usa las flechas ↑ y ↓ para repetir comandos anteriores.', 'tenue')
      ],
      explica: 'Esta es la lista de comandos que entiende el simulador. En una terminal real, Git tiene muchos más, pero estos son los del ciclo básico.'
    };
  }

  function lineasEstado(repo, cerrar) {
    const ls = [L('En la rama ' + repo.head)];
    if (!repo.punta()) { ls.push(L('')); ls.push(L('No hay commits todavía')); }
    const prep = repo.preparados(), noPrep = repo.noPreparados(), sin = repo.sinSeguimiento();
    const etiqueta = { nuevo: 'nuevo archivo:', modificado: 'modificado:', eliminado: 'borrado:' };
    if (prep.length) {
      ls.push(L(''));
      ls.push(L('Cambios a ser confirmados:'));
      ls.push(L('  (usa "git restore --staged <archivo>..." para sacar del área de preparación)', 'tenue'));
      for (const p of prep) ls.push(L('\t' + etiqueta[p.tipo].padEnd(16) + p.f, 'ok'));
    }
    if (noPrep.length) {
      ls.push(L(''));
      ls.push(L('Cambios no rastreados para el commit:'));
      ls.push(L('  (usa "git add <archivo>..." para actualizar lo que será confirmado)', 'tenue'));
      for (const p of noPrep) ls.push(L('\t' + etiqueta[p.tipo].padEnd(16) + p.f, 'err'));
    }
    if (sin.length) {
      ls.push(L(''));
      ls.push(L('Archivos sin seguimiento:'));
      ls.push(L('  (usa "git add <archivo>..." para incluirlo a lo que será confirmado)', 'tenue'));
      for (const f of sin) ls.push(L('\t' + f, 'err'));
    }
    ls.push(L(''));
    if (!prep.length) {
      if (noPrep.length) ls.push(L('sin cambios agregados al commit (usa "git add" y/o "git commit -a")'));
      else if (sin.length) ls.push(L('no hay nada agregado al commit pero hay archivos sin seguimiento presentes (usa "git add" para hacerles seguimiento)'));
      else ls.push(L(cerrar ? 'nada para hacer commit, el árbol de trabajo está limpio' : 'nada para hacer commit, el árbol de trabajo está limpio'));
    }
    return { ls, prep, noPrep, sin };
  }

  function cmdStatus(repo) {
    const { ls, prep, noPrep, sin } = lineasEstado(repo);
    const partes = [];
    if (sin.length) partes.push(plural(sin.length, 'archivo que Git todavía no rastrea', 'archivos que Git todavía no rastrea') + ' (' + sin.join(', ') + ')');
    if (noPrep.length) partes.push(plural(noPrep.length, 'archivo modificado sin preparar', 'archivos modificados sin preparar') + ' (' + noPrep.map(p => p.f).join(', ') + ')');
    if (prep.length) partes.push(plural(prep.length, 'archivo preparado para la próxima fotografía', 'archivos preparados para la próxima fotografía') + ' (' + prep.map(p => p.f).join(', ') + ')');
    const explica = partes.length
      ? 'git status solo informa, no cambia nada. Tienes ' + partes.join('; ') + '. En verde aparece lo preparado y en rojo lo que todavía no.'
      : 'git status solo informa, no cambia nada. Todo está confirmado: tu directorio de trabajo coincide con la última fotografía.';
    return { tipo: 'status', lineas: ls, explica };
  }

  function cmdInit(repo) {
    if (repo.iniciado) {
      return { tipo: 'init', lineas: [L('Reinicializado el repositorio Git existente en /home/estudiante/mi-portafolio/.git/')], explica: 'El repositorio ya existía. Volver a ejecutar git init no borra nada.' };
    }
    repo.iniciado = true;
    repo.ramas = { main: null };
    repo.carril = { main: 0 };
    repo.head = 'main';
    return {
      tipo: 'init',
      lineas: [L('Inicializado repositorio Git vacío en /home/estudiante/mi-portafolio/.git/')],
      explica: 'Git creó la carpeta oculta .git, donde guardará todo el historial. Tu carpeta ya es un repositorio, pero el álbum está vacío: todavía no hay fotografías. Fíjate en que ahora la terminal muestra la rama en la que estás: main.'
    };
  }

  function cmdAdd(repo, args) {
    if (!args.length) {
      return { tipo: 'error', lineas: [L('Nada especificado, nada agregado.'), L('ayuda: ¿Tal vez quisiste decir \'git add .\'?', 'amarillo')], explica: 'git add necesita saber qué preparar: el nombre de un archivo o un punto (.) para preparar todo.' };
    }
    const preparados = [];
    const todos = args.some(a => a === '.' || a === '-A' || a === '--all' || a === '*');
    const objetivos = todos ? [...new Set([...Object.keys(repo.trabajo), ...Object.keys(repo.indice)])] : args;
    for (const f of objetivos) {
      if (f in repo.trabajo) {
        if (repo.indice[f] !== repo.trabajo[f]) preparados.push(f);
        repo.indice[f] = repo.trabajo[f];
      } else if (f in repo.indice) {
        delete repo.indice[f]; preparados.push(f);
      } else {
        return { tipo: 'error', lineas: [L("fatal: ruta especificada '" + f + "' no concordó con ningún archivo", 'err')], explica: 'No existe ningún archivo llamado "' + f + '" en la carpeta. Revisa cómo se escribe; puedes usar ls para ver los archivos.' };
      }
    }
    const explica = preparados.length
      ? 'git add no muestra ningún mensaje cuando todo sale bien. Preparaste ' + preparados.join(' y ') + ': ' + (preparados.length === 1 ? 'ese cambio ya está' : 'esos cambios ya están') + ' en el encuadre de la próxima fotografía. Mira el área de preparación.'
      : 'No había cambios nuevos que preparar en ' + (todos ? 'la carpeta' : args.join(', ')) + '.';
    return { tipo: 'add', lineas: [], explica, preparados };
  }

  function cmdRestore(repo, args, comoReset) {
    const staged = comoReset || args.includes('--staged');
    const archivos = args.filter(a => a !== '--staged' && a !== 'HEAD' && a !== '--');
    if (!archivos.length) return { tipo: 'error', lineas: [L('fatal: debes especificar una ruta para restaurar', 'err')], explica: 'Indica el archivo, por ejemplo: git restore --staged estilos.css' };
    const ah = repo.arbolHead();
    for (const f of archivos) {
      if (!(f in repo.trabajo) && !(f in repo.indice) && !(f in ah)) {
        return { tipo: 'error', lineas: [L("error: ruta especificada '" + f + "' no concordó con ningún archivo conocido por git", 'err')], explica: 'No existe ningún archivo llamado "' + f + '".' };
      }
      if (staged) { if (f in ah) repo.indice[f] = ah[f]; else delete repo.indice[f]; }
      else if (f in repo.indice) repo.trabajo[f] = repo.indice[f];
    }
    return {
      tipo: 'restore', lineas: [],
      explica: staged
        ? 'Sacaste ' + archivos.join(', ') + ' del área de preparación. El archivo sigue igual en tu directorio de trabajo; solo dejó de estar en el encuadre.'
        : 'Descartaste los cambios de ' + archivos.join(', ') + ' en tu directorio de trabajo: volvió a la versión preparada.'
    };
  }

  function cmdCommit(repo, args) {
    let mensaje = null, todo = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-m' || a === '--message') { mensaje = args[i + 1] !== undefined ? args[i + 1] : ''; i++; }
      else if (a === '-am') { todo = true; mensaje = args[i + 1] !== undefined ? args[i + 1] : ''; i++; }
      else if (a === '-a' || a === '--all') todo = true;
      else if (a.startsWith('-m') && a.length > 2) mensaje = a.slice(2);
    }
    if (mensaje === null) {
      return {
        tipo: 'error',
        lineas: [L('Este simulador no abre un editor de texto.', 'amarillo'), L('Escribe el mensaje en la misma línea: git commit -m "Tu mensaje"', 'amarillo')],
        explica: 'En una computadora real, git commit sin -m abre un editor para que escribas el mensaje. Aquí lo escribimos directamente con -m y el mensaje entre comillas.'
      };
    }
    if (!mensaje.trim()) {
      return { tipo: 'error', lineas: [L('Abortando commit debido a que el mensaje de commit está vacío.', 'err')], explica: 'Todo commit necesita un mensaje que describa el cambio.' };
    }
    if (todo) for (const f of Object.keys(repo.indice)) { if (f in repo.trabajo) repo.indice[f] = repo.trabajo[f]; else delete repo.indice[f]; }
    const prep = repo.preparados();
    if (!prep.length) {
      const { ls, noPrep, sin } = lineasEstado(repo);
      return {
        tipo: 'commit-vacio', lineas: ls,
        explica: (noPrep.length || sin.length)
          ? 'No se guardó nada: git commit solo fotografía lo que está en el área de preparación, y está vacía. Primero usa git add.'
          : 'No se guardó nada porque no hay cambios: todo ya está confirmado.'
      };
    }
    const padre = repo.punta();
    const raiz = !padre;
    const antes = repo.arbol(padre);
    const h = repo.crearCommit(mensaje.trim(), padre ? [padre] : [], repo.indice);
    const lineas = [L('[' + repo.head + (raiz ? ' (commit-raíz)' : '') + ' ' + h + '] ' + mensaje.trim())];
    lineas.push(L(' ' + plural(prep.length, 'archivo cambiado', 'archivos cambiados')));
    for (const p of prep) {
      if (p.tipo === 'nuevo') lineas.push(L(' create mode 100644 ' + p.f));
      else if (p.tipo === 'eliminado' && p.f in antes) lineas.push(L(' delete mode 100644 ' + p.f));
    }
    let explica = '¡Fotografía tomada! Git guardó en el historial ' + (prep.length === 1 ? 'el cambio preparado' : 'los ' + prep.length + ' cambios preparados') + ' con el identificador ' + h + '. La rama ' + repo.head + ' ahora apunta a este commit.';
    let consejo = false;
    const m = mensaje.trim().toLowerCase();
    if (MENSAJES_VAGOS.includes(m) || m.length < 4) {
      explica += ' Un consejo: "' + mensaje.trim() + '" no le dice mucho a quien lea el historial. Prueba con un verbo que describa el cambio, como "Agrega página principal".';
      consejo = true;
    }
    return { tipo: 'commit', lineas, explica, consejo, nuevoCommit: h };
  }

  function alcanzables(repo, desde) {
    return [...repo.ancestros(desde)].sort((a, b) => repo.commits[b].n - repo.commits[a].n);
  }

  function cmdLog(repo, args) {
    if (!repo.punta()) {
      return { tipo: 'error', lineas: [L("fatal: tu rama actual '" + repo.head + "' no tiene ningún commit todavía", 'err')], explica: 'El historial está vacío porque aún no has hecho ningún commit.' };
    }
    const oneline = args.includes('--oneline');
    const grafo = args.includes('--graph');
    const lista = alcanzables(repo, repo.punta());
    const lineas = [];
    const formato = (h) => {
      const c = repo.commits[h];
      const deco = repo.decoraciones(h);
      if (oneline) return [{ t: h + ' ', c: 'amarillo' }, { t: deco ? deco + ' ' : '', c: 'ok' }, { t: c.mensaje, c: '' }];
      return null;
    };
    if (grafo) {
      let abierto = false;
      for (let i = 0; i < lista.length; i++) {
        const h = lista[i], c = repo.commits[h];
        let prefijo;
        if (c.padres.length === 2) { prefijo = '*   '; }
        else if (abierto) { prefijo = c.carril === 1 ? '| * ' : '* | '; }
        else prefijo = '* ';
        pushCommit(prefijo, h, abierto || c.padres.length === 2 ? '| | ' : '| ');
        if (c.padres.length === 2) { lineas.push(L('|\\  ', 'tenue')); abierto = true; }
        else if (abierto) {
          const quedan = lista.slice(i + 1).some(x => repo.commits[x].carril === 1);
          if (!quedan) { lineas.push(L('|/  ', 'tenue')); abierto = false; }
        }
      }
    } else {
      for (const h of lista) pushCommit('', h, '');
    }
    function pushCommit(prefijo, h, sangria) {
      const c = repo.commits[h];
      if (oneline) {
        const partes = formato(h);
        lineas.push({ partes: [{ t: prefijo, c: 'tenue' }].concat(partes) });
      } else {
        const deco = repo.decoraciones(h);
        lineas.push({ partes: [{ t: prefijo, c: 'tenue' }, { t: 'commit ' + c.largo, c: 'amarillo' }, { t: deco ? ' ' + deco : '', c: 'ok' }] });
        if (c.padres.length === 2) lineas.push(L(sangria + 'Merge: ' + c.padres.join(' ')));
        lineas.push(L(sangria + 'Autor: Estudiante <estudiante@ejemplo.com>'));
        lineas.push(L(sangria + 'Fecha: ' + FECHA.format(c.fecha)));
        lineas.push(L(sangria));
        lineas.push(L(sangria + '    ' + c.mensaje));
        lineas.push(L(sangria));
      }
    }
    let explica = 'Este es tu álbum: ' + plural(lista.length, 'fotografía', 'fotografías') + ' en la rama ' + repo.head + ', de la más reciente a la más antigua.';
    explica += oneline ? ' Con --oneline ves cada commit en una línea: su identificador y su mensaje.' : ' Cada commit muestra su identificador completo, autor, fecha y mensaje. Prueba git log --oneline para una versión compacta.';
    if (grafo) explica += ' Con --graph, las líneas de la izquierda dibujan cómo se separaron y unieron las ramas.';
    return { tipo: 'log', lineas, explica };
  }

  function nombreValido(n) { return /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(n) && !n.endsWith('.') && !n.includes('..'); }

  function cmdBranch(repo, args) {
    if (!args.length) {
      if (!repo.punta() && Object.keys(repo.ramas).length <= 1) {
        return { tipo: 'branch-lista', lineas: [], explica: 'No aparece ninguna rama porque todavía no hay commits. La rama main existe hasta que haces tu primera fotografía.' };
      }
      const lineas = ordenar(Object.keys(repo.ramas)).map(r => r === repo.head ? L('* ' + r, 'ok') : L('  ' + r));
      const n = Object.keys(repo.ramas).length;
      return { tipo: 'branch-lista', lineas, explica: 'Tienes ' + plural(n, 'rama', 'ramas') + '. El asterisco (*) marca la rama donde estás: ' + repo.head + '.' };
    }
    if (args[0] === '-d' || args[0] === '-D' || args[0] === '--delete') {
      const n = args[1];
      if (!n) return { tipo: 'error', lineas: [L('fatal: nombre de rama requerido', 'err')], explica: 'Indica qué rama quieres borrar.' };
      if (!(n in repo.ramas)) return { tipo: 'error', lineas: [L("error: rama '" + n + "' no encontrada", 'err')], explica: 'No existe una rama llamada "' + n + '".' };
      if (n === repo.head) return { tipo: 'error', lineas: [L("error: No se puede borrar la rama '" + n + "' que está activa en tu directorio de trabajo", 'err')], explica: 'No puedes borrar la rama en la que estás. Cámbiate primero a otra rama.' };
      if (args[0] === '-d' && repo.ramas[n] && !repo.esAncestro(repo.ramas[n], repo.punta())) {
        return { tipo: 'error', lineas: [L("error: La rama '" + n + "' no ha sido fusionada completamente.", 'err')], explica: 'Git te protege: esa rama tiene commits que no están en ' + repo.head + '. Si la borraras, podrías perder ese trabajo. Fusiónala primero.' };
      }
      const era = repo.ramas[n];
      delete repo.ramas[n];
      return { tipo: 'branch-borrar', lineas: [L('Eliminada la rama ' + n + ' (era ' + era + ').')], explica: 'Borraste la etiqueta ' + n + ', no el trabajo: sus commits siguen en el historial de ' + repo.head + ' gracias a la fusión. Es una buena práctica de limpieza.' };
    }
    if (args[0].startsWith('-')) {
      return { tipo: 'error', lineas: [L('Este simulador no incluye la opción ' + args[0] + '.', 'amarillo')], explica: 'Esa opción existe en Git, pero no forma parte de esta práctica.' };
    }
    const n = args[0];
    if (!repo.punta()) return { tipo: 'error', lineas: [L("fatal: no es un nombre de objeto válido: '" + repo.head + "'.", 'err')], explica: 'Para crear una rama necesitas al menos un commit: la rama nueva apuntará a esa fotografía.' };
    if (!nombreValido(n)) return { tipo: 'error', lineas: [L("fatal: '" + n + "' no es un nombre de rama válido.", 'err')], explica: 'Los nombres de rama no llevan espacios ni caracteres especiales. Usa guiones, por ejemplo: nueva-seccion.' };
    if (n in repo.ramas) return { tipo: 'error', lineas: [L("fatal: ya existe una rama llamada '" + n + "'.", 'err')], explica: 'Ya hay una rama con ese nombre. Si quieres moverte a ella, usa git switch ' + n + '.' };
    repo.ramas[n] = repo.punta();
    repo.carril[n] = 1;
    return { tipo: 'branch-crear', lineas: [], explica: 'Creaste la rama ' + n + ': una etiqueta nueva que apunta a la misma fotografía que ' + repo.head + '. Ojo: sigues en ' + repo.head + '. Para moverte a la nueva rama usa git switch ' + n + '.' };
  }

  function resolverAlias(repo, n) {
    if (n === 'master' && !('master' in repo.ramas) && 'main' in repo.ramas) return { n: 'main', nota: 'En este simulador la rama principal se llama main (en Pro Git verás master).' };
    return { n, nota: '' };
  }

  function cmdSwitch(repo, args, comoCheckout) {
    const flagCrear = comoCheckout ? '-b' : '-c';
    let crear = false, nombre = null;
    for (const a of args) {
      if (a === flagCrear || a === '-c' || a === '-b' || a === '--create') crear = true;
      else if (!a.startsWith('-')) nombre = nombre || a;
    }
    const cmd = comoCheckout ? 'git checkout' : 'git switch';
    const notaCheckout = comoCheckout ? ' (git checkout funciona igual; hoy se recomienda git switch para cambiar de rama.)' : '';
    if (!nombre) return { tipo: 'error', lineas: [L('fatal: falta el nombre de la rama', 'err')], explica: 'Indica a qué rama quieres cambiarte, por ejemplo: ' + cmd + ' main' };
    if (crear) {
      if (!nombreValido(nombre)) return { tipo: 'error', lineas: [L("fatal: '" + nombre + "' no es un nombre de rama válido.", 'err')], explica: 'Los nombres de rama no llevan espacios. Usa guiones, por ejemplo: nueva-seccion.' };
      if (nombre in repo.ramas) return { tipo: 'error', lineas: [L("fatal: ya existe una rama llamada '" + nombre + "'.", 'err')], explica: 'Esa rama ya existe. Para moverte a ella usa ' + cmd + ' ' + nombre + ' (sin ' + flagCrear + ').' };
      repo.ramas[nombre] = repo.punta();
      repo.carril[nombre] = 1;
      const de = repo.head;
      repo.head = nombre;
      return { tipo: 'switch', lineas: [L("Cambiado a nueva rama '" + nombre + "'")], explica: 'Creaste la rama ' + nombre + ' y te cambiaste a ella en un solo paso. Por ahora apunta a la misma fotografía que ' + de + '; a partir de aquí, tus nuevos commits avanzarán solo en ' + nombre + '. Fíjate en la terminal: ahora dice (' + nombre + ').' + notaCheckout, desde: de, hacia: nombre, desaparecen: [], aparecen: [] };
    }
    const alias = resolverAlias(repo, nombre);
    nombre = alias.n;
    if (!(nombre in repo.ramas)) {
      return { tipo: 'error', lineas: [L('fatal: referencia inválida: ' + nombre, 'err')], explica: 'No existe una rama llamada "' + nombre + '". Si quieres crearla y cambiarte a ella, usa ' + cmd + ' ' + flagCrear + ' ' + nombre + '.' };
    }
    if (nombre === repo.head) return { tipo: 'switch-mismo', lineas: [L("Ya en '" + nombre + "'")], explica: 'Ya estás en la rama ' + nombre + '.' + (alias.nota ? ' ' + alias.nota : '') };
    const destino = repo.arbol(repo.ramas[nombre]);
    const conflictos = repo.conflictosAlCambiar(destino);
    if (conflictos.length) {
      return {
        tipo: 'error',
        lineas: [L('error: Los cambios locales de los siguientes archivos serán sobrescritos al cambiar de rama:', 'err')]
          .concat(conflictos.map(f => L('\t' + f, 'err')))
          .concat([L('Por favor, confirma tus cambios o guárdalos antes de cambiar de rama.', 'err'), L('Abortando', 'err')]),
        explica: 'Git te protege: si cambiaras de rama perderías cambios que no has confirmado. Primero haz git add y git commit.'
      };
    }
    const de = repo.head;
    const cambios = repo.aplicarArbol(destino); // compara contra la rama de origen antes de mover HEAD
    repo.head = nombre;
    let explica = 'Te cambiaste a la rama ' + nombre + '. Tu directorio de trabajo se actualizó para reflejar su última fotografía.';
    if (cambios.desaparecen.length) explica += ' ' + cambios.desaparecen.join(', ') + (cambios.desaparecen.length === 1 ? ' desapareció' : ' desaparecieron') + ' de tu carpeta: no se borró, solo existe en la rama ' + de + '.';
    if (cambios.aparecen.length) explica += ' ' + cambios.aparecen.join(', ') + (cambios.aparecen.length === 1 ? ' apareció' : ' aparecieron') + ' porque existe en esta rama.';
    if (alias.nota) explica += ' ' + alias.nota;
    explica += notaCheckout;
    return { tipo: 'switch', lineas: [L("Cambiado a rama '" + nombre + "'")], explica, desde: de, hacia: nombre, desaparecen: cambios.desaparecen, aparecen: cambios.aparecen, destacado: cambios.desaparecen.length > 0 };
  }

  function cmdMerge(repo, args) {
    let nombre = args.find(a => !a.startsWith('-'));
    if (!nombre) return { tipo: 'error', lineas: [L('fatal: no se especificó ninguna rama para fusionar', 'err')], explica: 'Indica qué rama quieres traer a la rama actual, por ejemplo: git merge contacto' };
    const alias = resolverAlias(repo, nombre);
    nombre = alias.n;
    if (!(nombre in repo.ramas)) return { tipo: 'error', lineas: [L('merge: ' + nombre + ' - no es algo que podamos fusionar', 'err')], explica: 'No existe una rama llamada "' + nombre + '". Usa git branch para ver las ramas disponibles.' };
    const nuestra = repo.punta(), suya = repo.ramas[nombre];
    if (nombre === repo.head) {
      return { tipo: 'merge-nada', lineas: [L('Ya está actualizado.')], explica: 'Ya estás en la rama ' + nombre + ', así que no hay nada que fusionar. git merge trae los cambios de otra rama hacia la rama donde estás: para integrar ' + nombre + ' en main, cámbiate primero a main con git switch main.' };
    }
    if (suya && nuestra && repo.esAncestro(suya, nuestra)) {
      let explica = 'No hay nada que traer: todos los commits de ' + nombre + ' ya están en ' + repo.head + '.';
      if (repo.head !== 'main' && nombre === 'main') explica += ' Recuerda: git merge trae los cambios hacia la rama donde estás. Para integrar ' + repo.head + ' en main, primero cámbiate a main con git switch main y desde ahí ejecuta git merge ' + repo.head + '.';
      return { tipo: 'merge-nada', lineas: [L('Ya está actualizado.')], explica };
    }
    if (repo.hayCambiosLocales()) {
      return { tipo: 'error', lineas: [L('error: Tus cambios locales serían sobrescritos por la fusión.', 'err'), L('Por favor, confirma tus cambios o guárdalos antes de fusionar.', 'err'), L('Abortando', 'err')], explica: 'Antes de fusionar, confirma tus cambios pendientes con git add y git commit.' };
    }
    const antes = repo.arbolHead();
    if (!nuestra || repo.esAncestro(nuestra, suya)) {
      repo.ramas[repo.head] = suya;
      // avance rápido: el directorio de trabajo pasa al árbol de la otra rama
      const destino = repo.arbol(suya);
      for (const f of Object.keys(antes)) if (!(f in destino)) { delete repo.trabajo[f]; delete repo.indice[f]; }
      for (const f of Object.keys(destino)) { repo.trabajo[f] = destino[f]; repo.indice[f] = destino[f]; }
      const lineas = [L('Actualizando ' + (nuestra || '0000000') + '..' + suya), L('Fast-forward')];
      const cambiados = Object.keys(destino).filter(f => destino[f] !== antes[f]);
      for (const f of cambiados) lineas.push(L(' ' + f.padEnd(14) + ' | 1 +', 'ok'));
      return { tipo: 'merge', lineas, explica: 'Fusión de avance rápido (fast-forward): como ' + repo.head + ' no tenía commits nuevos, Git solo movió la etiqueta ' + repo.head + ' hasta la punta de ' + nombre + '. No hizo falta un commit de fusión.', ff: true };
    }
    const base = repo.arbol(repo.baseFusion(nuestra, suya));
    const ours = repo.arbol(nuestra), theirs = repo.arbol(suya);
    const fusion = {}, conflictos = [];
    for (const f of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
      const b = base[f], o = ours[f], t = theirs[f];
      let r;
      if (o === t) r = o;
      else if (t === b) r = o;
      else if (o === b) r = t;
      else { conflictos.push(f); r = o; }
      if (r !== undefined) fusion[f] = r;
    }
    if (conflictos.length) {
      return {
        tipo: 'error',
        lineas: conflictos.map(f => L('CONFLICTO (contenido): Conflicto de fusión en ' + f, 'err')).concat([L('Este simulador no resuelve conflictos; la fusión se canceló.', 'amarillo')]),
        explica: 'Las dos ramas cambiaron el mismo archivo de forma distinta. Eso es un conflicto, el tema que sigue después de esta experiencia.'
      };
    }
    repo.crearCommit("Merge branch '" + nombre + "'", [nuestra, suya], fusion);
    for (const f of Object.keys(antes)) if (!(f in fusion)) { delete repo.trabajo[f]; }
    for (const f of Object.keys(fusion)) { repo.trabajo[f] = fusion[f]; }
    repo.indice = Object.assign({}, fusion);
    const cambiados = ordenar(Object.keys(fusion).filter(f => fusion[f] !== antes[f]));
    const lineas = [L("Merge hecho por la estrategia 'ort'.")];
    for (const f of cambiados) lineas.push(L(' ' + f.padEnd(14) + ' | 1 +', 'ok'));
    lineas.push(L(' ' + plural(cambiados.length, 'archivo cambiado', 'archivos cambiados')));
    for (const f of cambiados) if (!(f in antes)) lineas.push(L(' create mode 100644 ' + f));
    const aparecen = cambiados.filter(f => !(f in antes));
    let explica = 'Git unió las dos líneas de trabajo con un commit especial de fusión (el círculo amarillo en el grafo), que tiene dos padres: la punta de ' + repo.head + ' y la punta de ' + nombre + '.';
    if (aparecen.length) explica += ' Por eso ' + aparecen.join(', ') + (aparecen.length === 1 ? ' volvió' : ' volvieron') + ' a aparecer en tu carpeta: ahora también ' + (aparecen.length === 1 ? 'forma' : 'forman') + ' parte de ' + repo.head + '.';
    return { tipo: 'merge', lineas, explica, destacado: true };
  }

  function ejecutar(repo, linea) {
    const t = tokens(linea.trim());
    if (!t.length) return { tipo: 'vacio', lineas: [] };
    const [c0, ...resto] = t;
    const c = c0.toLowerCase();
    if (c === 'clear' || c === 'limpiar' || c === 'cls') return { tipo: 'limpiar', lineas: [] };
    if (c === 'ayuda' || c === 'help') return ayuda();
    if (c === 'ls' || c === 'dir') {
      const archivos = ordenar(Object.keys(repo.trabajo));
      const ocultos = resto.includes('-a') || resto.includes('-la');
      const lista = (ocultos && repo.iniciado ? ['.git'] : []).concat(archivos);
      return { tipo: 'ls', lineas: [L(lista.join('   ') || '(carpeta vacía)')], explica: 'ls lista los archivos de tu carpeta, es decir, tu directorio de trabajo.' + (repo.iniciado && !ocultos ? ' La carpeta .git no aparece porque está oculta; usa ls -a para verla.' : '') };
    }
    if (c === 'cd' || c === 'pwd') return { tipo: 'otro', lineas: [L('/home/estudiante/mi-portafolio')], explica: 'En esta práctica trabajas siempre dentro de la carpeta mi-portafolio.' };
    if (c !== 'git') {
      return { tipo: 'error', lineas: [L(c0 + ': orden no encontrada', 'err')], explica: 'Esta terminal solo entiende comandos de Git (empiezan con git) y algunos básicos como ls. Escribe ayuda para ver la lista.' };
    }
    if (!resto.length || resto[0] === '--help' || resto[0] === 'help') return ayuda();
    const sub = resto[0].toLowerCase(), args = resto.slice(1);
    if (sub === '--version' || sub === 'version') return { tipo: 'otro', lineas: [L('git version 2.47.0 (simulador educativo)')], explica: 'Muestra la versión de Git instalada.' };
    if (sub === 'config') return { tipo: 'otro', lineas: [], explica: 'En tu computadora, git config guarda tu nombre y correo para los commits. En el simulador no hace falta: tus commits aparecen como "Estudiante".' };
    if (['clone', 'push', 'pull', 'remote', 'fetch'].includes(sub)) return { tipo: 'otro', lineas: [L('Este simulador trabaja solo con tu repositorio local.', 'amarillo')], explica: 'git ' + sub + ' se usa con repositorios remotos. Los verás en la Sección 5.' };
    if (['diff', 'stash'].includes(sub)) return { tipo: 'otro', lineas: [L('git ' + sub + ' no está incluido en este simulador.', 'amarillo')], explica: 'git ' + sub + ' es muy útil, pero queda fuera de esta práctica. Puedes probarlo cuando instales Git.' };
    if (!SUBCOMANDOS.includes(sub)) {
      const cercano = SUBCOMANDOS.map(s => ({ s, d: distancia(sub, s) })).sort((a, b) => a.d - b.d)[0];
      const lineas = [L("git: '" + sub + "' no es un comando de git. Mira 'git --help'.", 'err')];
      let explica = 'Git no reconoce "' + sub + '".';
      if (cercano && cercano.d <= 2) {
        lineas.push(L(''), L('El comando más parecido es'), L('\t' + cercano.s, 'amarillo'));
        explica += ' ¿Quisiste decir git ' + cercano.s + '?';
      }
      return { tipo: 'error', lineas, explica };
    }
    if (sub === 'init') return cmdInit(repo);
    if (!repo.iniciado) {
      return { tipo: 'error', lineas: [L('fatal: no es un repositorio git (ni ninguno de los directorios superiores): .git', 'err')], explica: 'Esta carpeta todavía no es un repositorio, así que Git no puede hacer nada aquí. Primero ejecuta git init.' };
    }
    switch (sub) {
      case 'status': return cmdStatus(repo);
      case 'add': return cmdAdd(repo, args);
      case 'commit': return cmdCommit(repo, args);
      case 'log': return cmdLog(repo, args);
      case 'branch': return cmdBranch(repo, args);
      case 'switch': return cmdSwitch(repo, args, false);
      case 'checkout': return cmdSwitch(repo, args, true);
      case 'merge': return cmdMerge(repo, args);
      case 'restore': return cmdRestore(repo, args, false);
      case 'reset': return cmdRestore(repo, args, true);
      case 'rm':
        if (args.includes('--cached')) { for (const f of args.filter(a => !a.startsWith('-'))) delete repo.indice[f]; return { tipo: 'restore', lineas: [], explica: 'Sacaste el archivo del seguimiento de Git sin borrarlo de tu carpeta.' }; }
        return { tipo: 'otro', lineas: [L('git rm sin --cached no está incluido en este simulador.', 'amarillo')], explica: 'Para esta práctica no necesitas borrar archivos.' };
      default: return ayuda();
    }
  }

  /* ---------------- Misiones ---------------- */
  const ARCHIVOS = { 'index.html': 'v1', 'estilos.css': 'v1' };

  const ACCIONES = {
    'editar-index': {
      etiqueta: 'Editar index.html',
      aplicar(repo) {
        repo.trabajo['index.html'] = 'v2';
        return { linea: '# Abriste index.html en tu editor, cambiaste el texto de presentación y guardaste.', explica: 'Editaste index.html en tu editor. Para Git ahora está modificado: el cambio vive solo en tu directorio de trabajo. Revísalo con git status.' };
      }
    },
    'crear-contacto': {
      etiqueta: 'Crear contacto.html',
      aplicar(repo) {
        if (repo.head !== 'contacto') return { error: 'Primero cámbiate a la rama contacto. Así el archivo nuevo quedará en esa rama y no en ' + repo.head + '.' };
        repo.trabajo['contacto.html'] = 'v1';
        return { linea: '# Creaste el archivo contacto.html con un formulario y lo guardaste.', explica: 'Creaste contacto.html. Es un archivo nuevo, así que Git todavía no lo rastrea. Prepáralo y confírmalo en esta rama.' };
      }
    },
    'corregir-index': {
      etiqueta: 'Corregir index.html',
      aplicar(repo) {
        if (repo.head !== 'main') return { error: 'Esta corrección va en la rama main. Cámbiate a main con git switch main.' };
        repo.trabajo['index.html'] = 'v3';
        return { linea: '# Corregiste una falta de ortografía en index.html y guardaste.', explica: 'Corregiste index.html en main. Confirma la corrección: así main y contacto tendrán cada una un commit que la otra no tiene.' };
      }
    }
  };

  const MISIONES = {
    1: {
      inicio: 'Aquí verás qué hizo cada comando. Empieza por el paso 1 escribiendo en la terminal.',
      pasos: [
        { instr: 'Convierte la carpeta en un repositorio.', pista: 'escribe <code>git init</code>', ok: (r) => r.iniciado },
        { instr: 'Revisa el estado de tus archivos.', pista: 'escribe <code>git status</code>', ok: (r, u) => u && u.tipo === 'status' },
        { instr: 'Prepara solo index.html.', pista: 'escribe <code>git add index.html</code>', ok: (r) => 'index.html' in r.indice && !('estilos.css' in r.indice) || r.orden.length > 0 },
        { instr: 'Vuelve a revisar el estado.', pista: 'escribe <code>git status</code>', ok: (r, u) => u && u.tipo === 'status' },
        { instr: 'Confirma el cambio con un mensaje descriptivo.', pista: 'escribe <code>git commit -m "Agrega página principal"</code>', ok: (r) => r.orden.length >= 1 },
        { instr: 'Prepara y confirma estilos.css.', pista: 'escribe <code>git add estilos.css</code> y después <code>git commit -m "Agrega estilos"</code>', ok: (r) => 'estilos.css' in r.arbolHead() },
        { instr: 'Pulsa "Editar index.html" y guarda el cambio en el historial.', pista: 'pulsa el botón; luego escribe <code>git status</code>, <code>git add index.html</code> y <code>git commit -m "Actualiza la presentación"</code>', accion: 'editar-index', ok: (r) => r.arbolHead()['index.html'] === 'v2' },
        { instr: 'Consulta tu historial.', pista: 'escribe <code>git log --oneline</code>', ok: (r, u) => u && u.tipo === 'log' }
      ],
      exito: '<strong>¡Misión cumplida!</strong> Creaste tu primer repositorio y guardaste tres fotografías en el álbum. Ese es el ciclo que repetirás todos los días: editas, revisas, preparas y confirmas.'
    },
    2: {
      inicio: 'Este es el repositorio que construiste en la Misión 1, con tres commits en main. Empieza por el paso 1.',
      semilla(repo) {
        ejecutar(repo, 'git init');
        ejecutar(repo, 'git add index.html');
        ejecutar(repo, 'git commit -m "Agrega página principal"');
        ejecutar(repo, 'git add estilos.css');
        ejecutar(repo, 'git commit -m "Agrega estilos"');
        repo.trabajo['index.html'] = 'v2';
        ejecutar(repo, 'git add index.html');
        ejecutar(repo, 'git commit -m "Actualiza la presentación"');
        return '# Repositorio de la Misión 1 listo: 3 commits en main.';
      },
      pasos: [
        { instr: 'Revisa qué ramas existen.', pista: 'escribe <code>git branch</code>', ok: (r, u) => u && u.tipo === 'branch-lista' },
        { instr: 'Crea una rama llamada contacto y cámbiate a ella.', pista: 'escribe <code>git switch -c contacto</code>', ok: (r) => r.head === 'contacto' },
        { instr: 'Pulsa "Crear contacto.html" y confirma el archivo nuevo.', pista: 'pulsa el botón; luego escribe <code>git add contacto.html</code> y <code>git commit -m "Agrega página de contacto"</code>', accion: 'crear-contacto', ok: (r) => r.ramas.contacto && 'contacto.html' in r.arbol(r.ramas.contacto) },
        { instr: 'Regresa a la rama principal.', pista: 'escribe <code>git switch main</code>', ok: (r) => r.head === 'main' },
        { instr: 'Pulsa "Corregir index.html" y confirma la corrección en main.', pista: 'pulsa el botón; luego escribe <code>git add index.html</code> y <code>git commit -m "Corrige ortografía de la presentación"</code>', accion: 'corregir-index', ok: (r) => r.arbol(r.ramas.main)['index.html'] === 'v3' },
        { instr: 'Integra la rama contacto en main.', pista: 'escribe <code>git merge contacto</code>', ok: (r) => r.head === 'main' && 'contacto.html' in r.arbol(r.ramas.main) },
        { instr: 'Mira tu historial como grafo.', pista: 'escribe <code>git log --oneline --graph</code>', ok: (r, u) => u && u.tipo === 'log' },
        { instr: 'Extra: borra la rama que ya fusionaste.', pista: 'escribe <code>git branch -d contacto</code>', extra: true, ok: (r) => !('contacto' in r.ramas) }
      ],
      exito: '<strong>¡Misión cumplida!</strong> Trabajaste en una rama sin arriesgar main y luego las uniste con una fusión. Mira el grafo: la línea verde se separa y vuelve a la línea azul.',
      exitoExtra: '<strong>¡Extra completado!</strong> Borraste la etiqueta contacto, pero su trabajo sigue en main gracias a la fusión.'
    }
  };

  /* ---------------- Interfaz ---------------- */
  let contadorIds = 0;

  function montar(contenedor, opciones) {
    const idMision = Number(contenedor.dataset.mision);
    const def = MISIONES[idMision];
    const uid = 'sim' + (++contadorIds);
    const pasosPrincipales = def.pasos.filter(p => !p.extra).length;

    contenedor.innerHTML = `
      <ol class="sim-mapa" aria-hidden="true">${def.pasos.map(p => `<li class="${p.extra ? 'extra' : ''}"><span></span></li>`).join('')}</ol>
      <div class="sim-paso">
        <div>
          <span class="sim-paso-num"></span>
          <p class="sim-paso-instr"></p>
          <p class="sim-pista" hidden></p>
        </div>
        <button class="boton chico secundario sim-ver-pista" type="button">Ver pista</button>
      </div>
      <div class="sim-cuerpo">
        <div class="sim-terminal">
          <div class="sim-terminal-barra" aria-hidden="true"><i></i><i></i><i></i><span>mi-portafolio: terminal</span></div>
          <div class="sim-salida" role="log" aria-live="polite" aria-label="Salida de la terminal"></div>
          <form class="sim-entrada" autocomplete="off">
            <label for="${uid}-in"></label>
            <input id="${uid}-in" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-describedby="${uid}-ayuda">
          </form>
        </div>
        <div class="sim-lateral">
          <div class="sim-explica" aria-live="polite">
            <p class="sim-explica-titulo">¿Qué pasó?</p>
            <p class="sim-explica-texto"></p>
          </div>
          <div class="sim-acciones"></div>
        </div>
      </div>
      <div class="sim-paneles">
        <div class="sim-panel" data-panel="trabajo"><h4>Directorio de trabajo</h4><ul></ul></div>
        <div class="sim-panel" data-panel="preparacion"><h4>Área de preparación</h4><ul></ul></div>
        <div class="sim-panel" data-panel="repositorio"><h4>Repositorio</h4><ul></ul></div>
      </div>
      <div class="sim-grafo"><h4>Grafo de commits</h4><div class="sim-grafo-lienzo"></div></div>
      <div class="sim-exito" hidden><p></p></div>
      <div class="sim-pie">
        <span id="${uid}-ayuda">Escribe <code>ayuda</code> para ver los comandos disponibles.</span>
        <button class="enlace-boton sim-reiniciar" type="button">Reiniciar misión</button>
      </div>`;

    const $ = (s) => contenedor.querySelector(s);
    const salida = $('.sim-salida'), entrada = $('input'), etiquetaPrompt = $('label');
    const explicaTexto = $('.sim-explica-texto'), explicaCaja = $('.sim-explica');
    const pistaP = $('.sim-pista'), botonPista = $('.sim-ver-pista');
    const accionesCaja = $('.sim-acciones');
    const exito = $('.sim-exito');

    let repo, paso, historial, completada, extraHecho, previas = new Set(), ultimoCommit = null, memoria = [], posMemoria = 0;

    function prompt() {
      return '~/mi-portafolio' + (repo.iniciado ? ' (' + repo.head + ')' : '') + ' $';
    }

    function escribir(lineas) {
      for (const ln of lineas) {
        const span = document.createElement('span');
        span.className = 'l';
        if (ln.partes) {
          for (const p of ln.partes) { const s = document.createElement('span'); if (p.c) s.className = p.c; s.textContent = p.t; span.appendChild(s); }
        } else {
          if (ln.c) span.classList.add(ln.c);
          span.textContent = ln.t === '' ? ' ' : ln.t;
        }
        salida.appendChild(span);
      }
      salida.scrollTop = salida.scrollHeight;
    }
    function escribirComando(txt) {
      const span = document.createElement('span');
      span.className = 'l cmd';
      const b = document.createElement('b'); b.textContent = prompt() + ' ';
      span.appendChild(b); span.appendChild(document.createTextNode(txt));
      salida.appendChild(span);
    }
    function explicar(texto, destacado) {
      explicaTexto.textContent = texto;
      explicaCaja.classList.toggle('destacado', !!destacado);
    }

    function pasoActual() { return def.pasos[paso]; }

    function evaluar(ultimo) {
      let avanzo = false;
      while (paso < def.pasos.length && def.pasos[paso].ok(repo, ultimo)) {
        paso++; avanzo = true; ultimo = null; // los pasos que dependen del último comando no se encadenan
        if (paso === pasosPrincipales && !completada) {
          completada = true;
          opciones.alCompletar && opciones.alCompletar();
        }
        if (paso === def.pasos.length && def.exitoExtra) extraHecho = true;
      }
      return avanzo;
    }

    function pintarPaso() {
      const lis = contenedor.querySelectorAll('.sim-mapa li');
      lis.forEach((li, i) => { li.classList.toggle('hecho', i < paso); li.classList.toggle('actual', i === paso); });
      const p = pasoActual();
      const num = $('.sim-paso-num'), instr = $('.sim-paso-instr');
      if (p) {
        num.textContent = p.extra ? 'Paso extra (opcional)' : 'Paso ' + (paso + 1) + ' de ' + pasosPrincipales;
        instr.textContent = p.instr;
        pistaP.innerHTML = 'Pista: ' + p.pista + '.';
        pistaP.hidden = true;
        botonPista.hidden = false;
        $('.sim-paso').hidden = false;
      } else {
        $('.sim-paso').hidden = true;
      }
      // acciones del editor
      accionesCaja.innerHTML = '';
      if (p && p.accion) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'boton chico secundario sim-accion-editor';
        b.textContent = ACCIONES[p.accion].etiqueta;
        b.addEventListener('click', () => procesar('@' + p.accion, true));
        accionesCaja.appendChild(b);
      }
      if (completada) {
        exito.hidden = false;
        exito.querySelector('p').innerHTML = extraHecho && def.exitoExtra ? def.exito + ' ' + def.exitoExtra : def.exito;
      } else exito.hidden = true;
    }

    function chip(clase, texto) { return `<span class="chip ${clase}">${texto}</span>`; }

    function pintarPaneles(animar) {
      const nuevas = new Set();
      const item = (clave, html) => { nuevas.add(clave); const marcar = animar && !previas.has(clave) ? ' class="nuevo-cambio"' : ''; return `<li${marcar}>${html}</li>`; };
      // Directorio de trabajo
      const archivos = ordenar(Object.keys(repo.trabajo));
      let html = '';
      for (const f of archivos) {
        let estado = '';
        if (repo.iniciado) {
          if (!(f in repo.indice)) estado = chip('sinseguimiento', 'sin seguimiento');
          else if (repo.trabajo[f] !== repo.indice[f]) estado = chip('modificado', 'modificado');
          else if (repo.indice[f] !== repo.arbolHead()[f]) estado = chip('preparado', 'preparado');
          else estado = chip('sincambios', 'sin cambios');
        }
        html += item('t:' + f + ':' + estado + repo.trabajo[f], `<span>${esc(f)}</span>${estado}`);
      }
      if (!repo.iniciado) html += '<li class="vacio">Todavía no es un repositorio.</li>';
      $('[data-panel="trabajo"] ul').innerHTML = html || '<li class="vacio">Carpeta vacía.</li>';
      // Área de preparación
      html = '';
      if (repo.iniciado) {
        const prep = repo.preparados();
        const nombre = { nuevo: 'nuevo', modificado: 'modificado', eliminado: 'borrado' };
        for (const p of prep) html += item('p:' + p.f + ':' + repo.indice[p.f], `<span>${esc(p.f)}</span>${chip(p.tipo === 'nuevo' ? 'nuevo' : 'preparado', nombre[p.tipo])}`);
        if (!prep.length) html = '<li class="vacio">Vacía. Usa <code>git add</code> para preparar cambios.</li>';
      } else html = '<li class="vacio">No existe todavía.</li>';
      $('[data-panel="preparacion"] ul').innerHTML = html;
      // Repositorio
      html = '';
      if (repo.iniciado) {
        const lista = repo.punta() ? alcanzables(repo, repo.punta()).slice(0, 4) : [];
        for (const h of lista) html += item('r:' + h, `<span class="sim-hash">${h}</span><span class="sim-msg">${esc(repo.commits[h].mensaje)}</span>`).replace('<li', '<li data-commit');
        if (!lista.length) html = '<li class="vacio">Sin commits todavía en ' + esc(repo.head) + '.</li>';
        else html = `<li class="vacio">Estás en <strong>${esc(repo.head)}</strong>. Últimos commits:</li>` + html;
      } else html = '<li class="vacio">No existe todavía. Usa <code>git init</code>.</li>';
      $('[data-panel="repositorio"] ul').innerHTML = html;
      previas = nuevas;
      pintarGrafo(animar);
      etiquetaPrompt.textContent = prompt();
    }

    function pintarGrafo(animar) {
      const lienzo = $('.sim-grafo-lienzo');
      if (!repo.orden.length) { lienzo.innerHTML = '<p class="vacio">Todavía no hay fotografías en el álbum.</p>'; return; }
      const usaRama = repo.orden.some(h => repo.commits[h].carril === 1) || Object.keys(repo.ramas).length > 1;
      const yC = (c) => usaRama ? (c === 0 ? 92 : 44) : 50;
      const sep = 70, x0 = 36;
      const pos = {};
      repo.orden.forEach((h, i) => { pos[h] = { x: x0 + i * sep, y: yC(repo.commits[h].carril) }; });
      let aristas = '', nodos = '', etiquetas = '';
      for (const h of repo.orden) {
        const c = repo.commits[h], p2 = pos[h];
        c.padres.forEach((ph) => {
          const p1 = pos[ph];
          const carrilArista = (repo.commits[ph].carril === 1 || c.carril === 1) ? 1 : 0;
          if (p1.y === p2.y) aristas += `<path class="gv-linea l${carrilArista}" d="M${p1.x} ${p1.y} H${p2.x}"/>`;
          else {
            const mx = (p1.x + p2.x) / 2;
            aristas += `<path class="gv-linea l${carrilArista}" d="M${p1.x} ${p1.y} C ${mx} ${p1.y}, ${mx} ${p2.y}, ${p2.x} ${p2.y}"/>`;
          }
        });
      }
      for (const h of repo.orden) {
        const c = repo.commits[h], p = pos[h];
        const clase = 'gv-nodo l' + c.carril + (c.padres.length === 2 ? ' fusion' : '') + (animar && h === ultimoCommit ? ' nuevo' : '');
        nodos += `<circle class="${clase}" cx="${p.x}" cy="${p.y}" r="${c.padres.length === 2 ? 11 : 9}"><title>${h} ${esc(c.mensaje)}</title></circle>`;
      }
      // etiquetas de ramas y HEAD
      const porCommit = {};
      for (const r of ordenar(Object.keys(repo.ramas))) { const h = repo.ramas[r]; if (h) (porCommit[h] = porCommit[h] || []).push(r); }
      for (const h of Object.keys(porCommit)) {
        const p = pos[h];
        const arriba = repo.commits[h].carril === 1 || !usaRama;
        let y = arriba ? p.y - 34 : p.y + 16;
        if (!usaRama) y = p.y + 16;
        let x = p.x - 10;
        const refs = porCommit[h].sort((a, b) => (a === repo.head ? -1 : b === repo.head ? 1 : a.localeCompare(b)));
        for (const r of refs) {
          const w = r.length * 7.4 + 18;
          const carril = r === 'main' ? 0 : 1;
          etiquetas += `<g class="gv-etq l${carril}"><rect x="${x}" y="${y}" width="${w}" height="20"/><text x="${x + w / 2}" y="${y + 14}">${esc(r)}</text></g>`;
          x += w + 4;
          if (r === repo.head) {
            const wh = 46;
            etiquetas += `<g class="gv-etq head"><rect x="${x}" y="${y}" width="${wh}" height="20"/><text x="${x + wh / 2}" y="${y + 14}">HEAD</text></g>`;
            x += wh + 4;
          }
        }
      }
      const ancho = x0 + (repo.orden.length - 1) * sep + 200;
      const alto = usaRama ? 132 : 92;
      lienzo.innerHTML = `<svg width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Grafo con ${repo.orden.length} commits; estás en la rama ${esc(repo.head)}">${aristas}${nodos}${etiquetas}</svg>`;
      lienzo.scrollLeft = lienzo.scrollWidth;
    }

    function procesar(entradaTexto, interactivo) {
      let res;
      ultimoCommit = null;
      if (entradaTexto.startsWith('@')) {
        const acc = ACCIONES[entradaTexto.slice(1)];
        const r = acc.aplicar(repo);
        if (r.error) { if (interactivo) explicar(r.error, true); return; }
        escribir([{ t: r.linea, c: 'accion' }]);
        explicar(r.explica, false);
        res = { tipo: 'accion' };
      } else {
        escribirComando(entradaTexto);
        res = ejecutar(repo, entradaTexto);
        if (res.tipo === 'limpiar') { salida.innerHTML = ''; }
        else if (res.tipo !== 'vacio') escribir(res.lineas);
        if (res.explica) explicar(res.explica, res.destacado);
        if (res.nuevoCommit) ultimoCommit = res.nuevoCommit;
        // ayuda específica de la misión 1, paso 3: prepararon los dos archivos
        if (idMision === 1 && paso === 2 && 'index.html' in repo.indice && 'estilos.css' in repo.indice && !repo.orden.length) {
          explicar('Preparaste los dos archivos. Para este paso queremos solo index.html, así practicas elegir qué entra en la foto. Saca estilos.css del encuadre con git restore --staged estilos.css', true);
        }
        // merge desde la rama equivocada (misión 2)
        if (idMision === 2 && res.tipo === 'merge-nada' && repo.head === 'contacto') explicar(res.explica, true);
      }
      if (res.tipo === 'vacio') return;
      historial.push(entradaTexto);
      const antes = paso;
      evaluar(res);
      if (interactivo) {
        if (idMision === 2 && antes === 3 && paso > 3 && res.desaparecen && res.desaparecen.length) {
          explicar('¡Mira tu directorio de trabajo! contacto.html desapareció. No se borró: ese archivo solo existe en la rama contacto. Cuando la fusiones con main, volverá.', true);
        }
        opciones.guardar && opciones.guardar(historial.slice());
      }
      pintarPaso();
      pintarPaneles(interactivo);
    }

    function iniciar(guardado) {
      repo = new Repo(ARCHIVOS);
      paso = 0; historial = []; completada = false; extraHecho = false; previas = new Set();
      salida.innerHTML = '';
      if (def.semilla) escribir([{ t: def.semilla(repo), c: 'tenue' }]);
      escribir([{ t: '# Escribe tus comandos abajo y presiona Enter.', c: 'tenue' }]);
      explicar(def.inicio, false);
      pintarPaso();
      pintarPaneles(false);
      for (const e of guardado || []) procesar(e, false);
      if (guardado && guardado.length) { pintarPaneles(false); }
    }

    contenedor.querySelector('form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = entrada.value;
      entrada.value = '';
      if (v.trim()) { memoria.push(v); }
      posMemoria = memoria.length;
      procesar(v, true);
    });
    entrada.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowUp' && memoria.length) { ev.preventDefault(); posMemoria = Math.max(0, posMemoria - 1); entrada.value = memoria[posMemoria]; }
      else if (ev.key === 'ArrowDown' && memoria.length) { ev.preventDefault(); posMemoria = Math.min(memoria.length, posMemoria + 1); entrada.value = memoria[posMemoria] || ''; }
    });
    $('.sim-terminal').addEventListener('click', (ev) => { if (!window.getSelection().toString() && ev.target.tagName !== 'INPUT') entrada.focus({ preventScroll: true }); });
    botonPista.addEventListener('click', () => { pistaP.hidden = false; botonPista.hidden = true; });
    $('.sim-reiniciar').addEventListener('click', () => {
      if (!confirm('¿Reiniciar la misión? Se borrarán los comandos que escribiste en este simulador.')) return;
      opciones.guardar && opciones.guardar([]);
      iniciar([]);
      entrada.focus();
    });

    iniciar(opciones.historial || []);
    return { completada: () => completada };
  }

  window.Simulador = { montar, ejecutar, Repo, tokens };
})();
