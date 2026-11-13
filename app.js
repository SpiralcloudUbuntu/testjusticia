/* app.js — TestJusticia
   Motor de test, simulación, corrección, repaso de fallos y estadísticas.
   Regla dura: solo entran en el pool las preguntas con respuesta OFICIAL. */

/* "Muy falladas" = falladas MAS de 3 veces (es decir, 4 o mas). Pedido por Guti el 05/10/2026. */
const UMBRAL_MUY_FALLADAS = 3;

/* Version visible en Ajustes. Subir junto con CACHE_NAME de sw.js. */
const APP_VERSION = 'v17';

const AJUSTES_DEF = {
  testN: 25,
  simN: 100,
  simMin: 0,
  penal: 0,
  correccionInmediata: false,
  barajar: true,
  oscuro: false,
  letra: 'normal'
};

const App = {
  bancos: [],
  banco: null,
  sesion: null,
  ajustes: null,
  historial: [],
  porPregunta: {},
  fallos: [],
  examenesHechos: {},
  cfg: null,
  exCfg: null,
  ofFiltro: 'todos',
  _vistaTest: 'portada',
  _timer: null,
  _cronoFin: 0,

  /* ================= arranque ================= */

  init() {
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }
    // La cuenta es GLOBAL (sin sufijo): decide de qué espacio de datos se lee.
    // 'senor' = Señor de las Pruebas (Guti). Usa las claves de siempre, así que
    // los datos que ya existían se conservan intactos.
    this.cuenta = DB.get('cuenta', 'senor') || 'senor';
    this.cargarEstado();

    this.banco = this.bancos[0] || null;

    this.leerAjustesUI();
    this.aplicarTema();
    this._memFiltro = 'hoy';
    this._histFiltro = 'todos';
    this.cargarMemoria();
    this.pintarInicio();
    this.pintarStats();
    this.pintarMemoria();
    this.pintarListaTests();
    this.enganchar();
    this.vigilarActualizaciones();
    this.prepararInstalacion();
    this.vistaTest('portada');

    const guardada = this.dget('sesion', null);
    if (guardada && Array.isArray(guardada.preguntas) && guardada.preguntas.length) {
      // Al reabrir la app, el test que estaba en curso pasa a "a medias":
      // se ve en Resultados y se puede continuar desde ahí.
      this.sesion = guardada;
      this.pausarSesion();
    }
  },

  /* ---------- cuentas (espacios de datos separados) ---------- */

  sufijoCuenta() {
    return (this.cuenta && this.cuenta !== 'senor') ? ':' + this.cuenta : '';
  },

  nombreCuenta() {
    return this.cuenta === 'carolina' ? 'Carolina' : 'Señor de las Pruebas';
  },

  dget(k, d) { return DB.get(k + this.sufijoCuenta(), d); },
  dset(k, v) { return DB.set(k + this.sufijoCuenta(), v); },
  ddel(k) { return DB.del(k + this.sufijoCuenta()); },

  dborrarTodo() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(DB.PREFIX))
        .forEach((k) => {
          const esCarolina = k.endsWith(':carolina');
          const esSenor = !k.endsWith(':carolina') && !k.endsWith(':senor');
          if (this.cuenta === 'carolina' ? esCarolina : esSenor) localStorage.removeItem(k);
        });
    } catch (e) { console.error(e); }
  },

  /* Carga todo el estado de la cuenta activa. */
  cargarEstado() {
    this.ajustes = Object.assign({}, AJUSTES_DEF, this.dget('ajustes', {}) || {});
    this.filtroFuente = this.dget('filtroFuente', 'todas') || 'todas';
    this.historial = this.dget('historial', []) || [];
    this.porPregunta = this.dget('porPregunta', {}) || {};
    this.fallos = this.dget('fallos', []) || [];
    this.examenesHechos = this.dget('examenesHechos', {}) || {};
    this.cfg = Object.assign({ n: 25, min: 0, conjunto: 'todas' }, this.dget('cfg', {}) || {});
    this.mem = null;
    this.sesion = null;

    const importados = this.dget('bancos', []) || [];
    const base = Array.isArray(window.BANCOS) ? window.BANCOS : [];
    const vistos = new Set();
    this.bancos = base.concat(importados).filter((b) => {
      if (!b || !b.id || !Array.isArray(b.preguntas)) return false;
      if (vistos.has(b.id)) return false;
      vistos.add(b.id);
      return true;
    });
  },

  cambiarCuenta(c) {
    if (!c || c === this.cuenta) return;
    if (this.sesion) {
      this.confirmar(
        'Tienes un test en curso. Al cambiar de cuenta se guardará como "a medias".',
        'Cambiar de cuenta',
        () => { this.pausarSesion(); this._cambiarCuenta(c); },
        () => { const s = document.getElementById('set-cuenta'); if (s) s.value = this.cuenta; },
        'Cambiar',
        'Cancelar'
      );
      return;
    }
    this._cambiarCuenta(c);
  },

  _cambiarCuenta(c) {
    this.cuenta = c;
    DB.set('cuenta', c);
    this.cargarEstado();
    this.banco = this.bancos[0] || null;
    this._memFiltro = 'hoy';
    this._histFiltro = 'todos';
    this.leerAjustesUI();
    this.aplicarTema();
    this.cargarMemoria();
    this.pintarInicio();
    this.pintarStats();
    this.pintarMemoria();
    this.pintarListaTests();
    this.vistaTest('portada');
    this.toast('Cuenta: ' + this.nombreCuenta());
  },

  enganchar() {
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.tab) this.mostrarTab(b.dataset.tab);
        this.cerrarMenu();
      });
    });

    // Los chips de fuente del configurador tienen su propio manejador (más abajo).

    const mt = document.getElementById('menu-toggle');
    if (mt) mt.addEventListener('click', () => this.abrirMenu());
    const velo = document.getElementById('velo');
    if (velo) velo.addEventListener('click', () => this.cerrarMenu());
    this.$$('.js-ajustes').forEach((b) => b.addEventListener('click', () => this.abrirAjustes()));

    this.$$('[data-correccion]').forEach((b) => {
      b.addEventListener('click', () => this.setModo(b.dataset.correccion));
    });
    const chipM = document.getElementById('test-modo-chip');
    if (chipM) chipM.addEventListener('click', () => {
      this.setModo(this.ajustes.correccionInmediata ? 'examen' : 'estudio');
    });
    document.getElementById('btn-blanco').addEventListener('click', () => this.blanco());
    document.getElementById('btn-revision').addEventListener('click', () => this.toggleRevision());
    document.getElementById('btn-memorizar').addEventListener('click', () => this.memorizarActual());
    document.getElementById('btn-memoria-repasar').addEventListener('click', () => this.empezarMemoria());
    this.$$('#memoria-filtros [data-mem]').forEach((b) => {
      b.addEventListener('click', () => this.setMemFiltro(b.dataset.mem));
    });
    this.$$('#hist-filtros [data-hist]').forEach((b) => {
      b.addEventListener('click', () => this.setHistFiltro(b.dataset.hist));
    });
    this.$$('#rev-filtros [data-rev]').forEach((b) => {
      b.addEventListener('click', () => this.setRevFiltro(b.dataset.rev));
    });

    document.querySelectorAll('[data-modo]').forEach((b) => {
      b.addEventListener('click', () => this.empezar(b.dataset.modo));
    });

    document.getElementById('btn-ajustes').addEventListener('click', () => this.abrirAjustes());
    document.getElementById('btn-cerrar-ajustes').addEventListener('click', () => this.cerrarAjustes());
    document.getElementById('modal-ajustes').addEventListener('click', (e) => {
      if (e.target.id === 'modal-ajustes') this.cerrarAjustes();
    });

    document.getElementById('btn-siguiente').addEventListener('click', () => this.siguiente());
    document.getElementById('btn-anterior').addEventListener('click', () => this.anterior());
    document.getElementById('btn-finalizar').addEventListener('click', () => this.finalizar(false));
    document.getElementById('btn-abandonar').addEventListener('click', () => this.abandonar());
    document.getElementById('btn-repetir-fallos').addEventListener('click', () => this.empezar('fallos-sesion'));
    document.getElementById('btn-volver-inicio').addEventListener('click', () => this.mostrarTab('tab-inicio'));

    document.getElementById('btn-exportar').addEventListener('click', () => this.exportar());
    document.getElementById('btn-importar').addEventListener('click', () => document.getElementById('file-import').click());
    document.getElementById('file-import').addEventListener('change', (e) => this.importar(e));
    document.getElementById('btn-importar-pdf').addEventListener('click', () => this.abrirImportPDF());
    document.getElementById('file-pdf').addEventListener('change', (e) => this.importarPDF(e));
    document.getElementById('btn-guardar-pdf').addEventListener('click', () => this.guardarBancoPDF());
    document.getElementById('btn-cerrar-pdf').addEventListener('click', () => this.cerrarModalPDF());
    document.getElementById('btn-cancelar-pdf').addEventListener('click', () => this.cerrarModalPDF());
    document.getElementById('btn-actualizar').addEventListener('click', () => this.actualizarApp());
    document.getElementById('set-cuenta').addEventListener('change', (e) => this.cambiarCuenta(e.target.value));
    document.getElementById('inicio-empezar-falladas').addEventListener('click', () => this.empezarFalladasInicio());
    document.getElementById('inicio-empezar-memoria').addEventListener('click', () => this.empezarMemoria());
    const sl = document.getElementById('set-letra');
    if (sl) sl.addEventListener('change', () => this.guardarAjustesDesdeUI());
    const bc = document.getElementById('btn-cuenta');
    if (bc) bc.addEventListener('click', () => this.abrirAjustes());
    const bu = document.getElementById('btn-banner-update');
    if (bu) bu.addEventListener('click', () => this.actualizarApp());
    const bi = document.getElementById('btn-install');
    if (bi) bi.addEventListener('click', () => this.instalar());
    const bic = document.getElementById('btn-install-cerrar');
    if (bic) bic.addEventListener('click', () => this.cerrarBannerInstall());
    document.addEventListener('keydown', (e) => this.atajosTeclado(e));
    const ct = document.getElementById('caso-toggle');
    if (ct) ct.addEventListener('click', () => this.toggleCaso());
    const tpp = document.getElementById('btn-texto-pdf-procesar');
    if (tpp) tpp.addEventListener('click', () => this.procesarTextoPegado());
    const bocr = document.getElementById('btn-ocr-pdf');
    if (bocr) bocr.addEventListener('click', () => this.lanzarOCR());
    ['btn-texto-pdf-cancelar', 'btn-cerrar-texto-pdf'].forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.addEventListener('click', () => this.cerrarImportTexto());
    });
    const busc = document.getElementById('buscador');
    if (busc) {
      let t = null;
      busc.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => this.buscar(busc.value), 220);
      });
    }
    document.getElementById('btn-reset').addEventListener('click', () => this.reset());

    ['testN', 'simN', 'simMin', 'penal', 'correccionInmediata', 'barajar', 'oscuro'].forEach((k) => {
      const el = document.getElementById('set-' + this.idCampo(k));
      if (el) el.addEventListener('change', () => this.guardarAjustesDesdeUI());
    });

    /* --- portada del test: las dos opciones --- */
    const oCf = document.getElementById('opt-config');
    if (oCf) oCf.addEventListener('click', () => this.vistaTest('config'));
    const oCo = document.getElementById('opt-completo');
    if (oCo) oCo.addEventListener('click', () => this.vistaTest('completo'));
    const coV = document.getElementById('comp-volver');
    if (coV) coV.addEventListener('click', () => this.vistaTest('portada'));
    const exV = document.getElementById('ex-volver');
    if (exV) exV.addEventListener('click', () => this.vistaTest('completo'));
    const cfV = document.getElementById('cfg-volver');
    if (cfV) cfV.addEventListener('click', () => this.vistaTest('portada'));
    this.$$('#comp-fuente [data-comp-fuente]').forEach((b) =>
      b.addEventListener('click', () => { this._compFuente = b.dataset.compFuente; this.pintarCompletos(); }));

    this.$$('[data-of-filtro]').forEach((b) => {
      b.addEventListener('click', () => this.setFiltroOficiales(b.dataset.ofFiltro));
    });

    /* --- configurador de test --- */
    const inpN = document.getElementById('cfg-n');
    if (inpN) inpN.addEventListener('change', () => {
      const max = this.contarConjunto(this.cfg.tipo) || 1;
      const v = Math.max(1, Math.min(parseInt(inpN.value, 10) || 1, max));
      this.setCfg('n', v);
    });
    this.$$('[data-cfg-n]').forEach((b) => b.addEventListener('click', () => {
      const max = this.contarConjunto(this.cfg.tipo) || 1;
      const v = b.dataset.cfgN === 'max' ? max : parseInt(b.dataset.cfgN, 10);
      this.setCfg('n', Math.max(1, Math.min(v, max)));
    }));
    this.$$('[data-cfg-min]').forEach((b) => b.addEventListener('click', () => {
      if (this.ajustes.correccionInmediata) { this.toast('En modo estudio no hay tiempo: cambia a modo examen'); return; }
      this.setCfg('min', parseInt(b.dataset.cfgMin, 10) || 0);
    }));

    this.$$('#cfg-bloque [data-bloque]').forEach((b) => b.addEventListener('click', () => {
      const x = b.dataset.bloque;
      const arr = Array.isArray(this.cfg.bloques) ? this.cfg.bloques.slice() : ['test', 'caso', 'informatica'];
      const i = arr.indexOf(x);
      if (i >= 0) {
        if (arr.length === 1) { this.toast('Debe quedar al menos un bloque marcado'); return; }
        arr.splice(i, 1);
      } else {
        arr.push(x);
      }
      this.cfg.bloques = arr;
      const max = this.contarConjunto(this.cfg.tipo) || 0;
      if (max) this.cfg.n = Math.max(1, Math.min(this.cfg.n || max, max));
      this.dset('cfg', this.cfg);
      this.pintarConfig();
    }));

    const selLey = document.getElementById('cfg-ley');
    if (selLey) selLey.addEventListener('change', () => {
      this.cfg.ley = selLey.value;
      const max = this.contarConjunto(this.cfg.tipo) || 0;
      if (max) this.cfg.n = Math.max(1, Math.min(this.cfg.n || max, max));
      this.dset('cfg', this.cfg);
      this.pintarConfig();
    });

    this.$$('#cfg-tipo [data-tipo]').forEach((b) => b.addEventListener('click', () => {
      const max = this.contarConjunto(b.dataset.tipo) || 0;
      if (!max) { this.toast('No hay preguntas de ese tipo con los filtros actuales'); return; }
      this.cfg.tipo = b.dataset.tipo;
      this.cfg.n = Math.max(1, Math.min(this.cfg.n || max, max));
      this.dset('cfg', this.cfg);
      this.pintarConfig();
    }));

    this.$$('#cfg-fuente [data-fuente]').forEach((b) => b.addEventListener('click', () => {
      this.cfg.fuente = b.dataset.fuente;
      const max = this.contarConjunto(this.cfg.tipo) || 0;
      if (max) this.cfg.n = Math.max(1, Math.min(this.cfg.n || max, max));
      this.dset('cfg', this.cfg);
      this.pintarConfig();
    }));

    const selEx = document.getElementById('cfg-examen');
    if (selEx) selEx.addEventListener('change', () => {
      this.cfg.examen = selEx.value;
      const max = this.contarConjunto(this.cfg.tipo) || 0;
      if (max) this.cfg.n = Math.max(1, Math.min(this.cfg.n || max, max));
      this.dset('cfg', this.cfg);
      this.pintarConfig();
    });

    const cfgGo = document.getElementById('cfg-empezar');
    if (cfgGo) cfgGo.addEventListener('click', () => this.empezarConfig());

    /* --- examen oficial --- */
    this.$$('[data-ex-min]').forEach((b) => b.addEventListener('click', () => {
      if (this.ajustes.correccionInmediata) { this.toast('En modo estudio no hay tiempo: cambia a modo examen'); return; }
      this.exCfg = Object.assign({}, this.exCfg, { min: parseInt(b.dataset.exMin, 10) || 0 });
      this.pintarExamenCfg();
    }));
    const exGo = document.getElementById('ex-empezar');
    if (exGo) exGo.addEventListener('click', () => this.empezarExamen());

    this.pintarSegModo();
  },

  idCampo(k) {
    return { testN: 'test-n', simN: 'sim-n', simMin: 'sim-min', penal: 'penal', correccionInmediata: 'correccion-inmediata', barajar: 'barajar', oscuro: 'oscuro' }[k];
  },

  /* ================= utilidades ================= */

  $(sel) { return document.querySelector(sel); },
  $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); },

  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.add('hidden'), 2400);
  },

  barajar(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  },

  pct(ok, total) { return total > 0 ? Math.round((ok / total) * 100) : 0; },

  fechaCorta(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' +
             d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  },

  mmss(seg) {
    seg = Math.max(0, Math.floor(seg));
    const m = Math.floor(seg / 60), s = seg % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  },

  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  /* Clave de las estadísticas por pregunta = banco de origen + nº.
     El pool reúne preguntas de TODOS los exámenes, así que la clave lleva el
     banco de origen: así el recuento es el mismo en el examen suelto y en el pool. */
  clave(p) {
    const b = (p && p._banco) || (this.banco ? this.banco.id : '');
    return b + '#' + p.n;
  },

  /* Pool global: TODAS las preguntas con respuesta oficial de TODOS los exámenes.
     Cada pregunta recuerda su banco de origen en _banco. */
  poolGlobal() {
    const out = [];
    (this.bancos || []).forEach((b) => {
      (b.preguntas || []).forEach((p) => {
        if (!p.correcta) return;
        if (!p._banco) p._banco = b.id;
        out.push(p);
      });
    });
    return out;
  },

  /* ================= navegación ================= */

  /* ---------- diálogo de confirmación propio ----------
     No se usa window.confirm(): en PWA instalada, o tras varios diálogos
     seguidos, el navegador lo bloquea y devuelve false siempre. Eso dejaba
     al usuario encerrado en un test sin poder salir ni cambiar de pestaña. */
  confirmar(texto, titulo, onOk, onCancel, okTexto, cancelTexto) {
    const m = document.getElementById('modal-confirmar');
    if (!m) { if (onOk) onOk(); return; }
    document.getElementById('conf-titulo').textContent = titulo || 'Confirmar';
    document.getElementById('conf-texto').textContent = texto || '';
    const bOk = document.getElementById('conf-ok');
    const bNo = document.getElementById('conf-cancel');
    bOk.textContent = okTexto || 'Aceptar';
    bNo.textContent = cancelTexto || 'Cancelar';

    const cerrar = () => {
      m.classList.add('hidden');
      bOk.onclick = null;
      bNo.onclick = null;
    };
    bOk.onclick = () => { cerrar(); if (onOk) onOk(); };
    bNo.onclick = () => { cerrar(); if (onCancel) onCancel(); };
    m.classList.remove('hidden');
    bOk.focus();
  },

  mostrarTab(id) {
    // Si hay un test en curso y se va a otra pestaña, preguntar antes.
    if (this.sesion && id !== 'tab-test') {
      this.confirmarSalidaTest(id);
      return;
    }
    this._mostrarTab(id);
  },

  /* Pregunta al salir de un test en curso y navega si acepta. */
  confirmarSalidaTest(destino) {
    const s = this.sesion;
    if (!s) { this._mostrarTab(destino); return; }
    const hechas = Object.keys(s.respuestas || {}).length;
    const total = (s.preguntas || []).length;
    this.confirmar(
      'Tienes un test a medias (' + hechas + '/' + total + ' respondidas). ' +
      'Puedes guardarlo para continuar cuando quieras.',
      'Salir del test',
      () => { this.pausarSesion(); this._mostrarTab(destino); },
      null,
      'Guardar y salir',
      'Seguir en el test'
    );
  },

  _mostrarTab(id) {
    this.$$('.tab-content').forEach((s) => s.classList.add('hidden'));
    const sec = document.getElementById(id);
    if (sec) sec.classList.remove('hidden');
    this.$$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    this.cerrarMenu();
    if (id === 'tab-memoria') this.pintarMemoria();
    if (id === 'tab-resultados') this.pintarListaTests();
    if (id === 'tab-test') {
      // La pestaña Test abre SIEMPRE la portada, para elegir como hacerlo.
      // Solo se va directo al runner cuando lo pide una accion concreta
      // (continuar un test pausado, repasar MemorIA...).
      if (this._irRunner && this.sesion) {
        this._irRunner = false;
        this.vistaTest('runner');
      } else {
        this._irRunner = false;
        this.vistaTest('portada');
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  },

  /* Guarda la sesion en curso en la lista de "a medias". */
  pausarSesion() {
    const s = this.sesion;
    if (!s) return;
    s._pausada = true;
    s._guardada = new Date().toISOString();
    s._id = s._id || ('ses-' + Date.now());
    const lista = this.dget('pausadas', []) || [];
    const i = lista.findIndex((x) => x._id === s._id);
    if (i >= 0) lista[i] = s; else lista.push(s);
    this.dset('pausadas', lista);
    this.ddel('sesion');
    clearInterval(this._timer);
    this.sesion = null;
    this.toast('Test guardado. Lo tienes en Resultados.');
  },

  continuarPausada(id) {
    const lista = this.dget('pausadas', []) || [];
    const i = lista.findIndex((x) => x._id === id);
    if (i < 0) { this.toast('Ese test ya no existe'); return; }
    const s = lista.splice(i, 1)[0];
    this.dset('pausadas', lista);
    delete s._pausada;
    delete s._guardada;
    this.sesion = s;
    this.guardarSesion();
    this._irRunner = true;
    this.arrancarCrono();
    this.pintarPregunta();
    this.mostrarTab('tab-test');
  },

  descartarPausada(id) {
    this.confirmar('¿Descartar ese test a medias? No contará en tus estadísticas.', 'Descartar test',
      () => {
        const lista = (this.dget('pausadas', []) || []).filter((x) => x._id !== id);
        this.dset('pausadas', lista);
        this.pintarListaTests();
        this.pintarInicio();
        this.toast('Test descartado');
      },
      null, 'Descartar', 'Cancelar');
  },

  /* ================= inicio ================= */

  pintarInicio() {
    try {
      const c = this.cuentaFuentes();
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      set('chip-total', c.conRespuesta);
      set('chip-ofi', c.oficial);
      set('chip-pre', c.preparador);

      // --- continuar el test a medias mas reciente ---
      const cont = document.getElementById('inicio-continuar');
      if (cont) {
        const pausadas = (this.dget('pausadas', []) || []).slice()
          .sort((a, b) => String(b._guardada || '').localeCompare(String(a._guardada || '')));
        if (!pausadas.length) {
          cont.innerHTML = '<div class="card"><div class="card-meta">No tienes ningún test a medias. Empieza uno desde la pestaña Test.</div></div>';
        } else {
          const s = pausadas[0];
          const hechas = Object.keys(s.respuestas || {}).length;
          const total = (s.preguntas || []).length;
          const pct = total ? Math.round(hechas / total * 100) : 0;
          cont.innerHTML = '<div class="test-item abierto">' +
            '<div class="test-item-cab"><span class="test-badge abierto">A medias</span>' +
            '<span class="test-item-fecha">' + this.fechaCorta(s._guardada) + '</span></div>' +
            '<div class="test-item-t">' + this.esc(s.titulo || 'Test') + '</div>' +
            '<div class="test-item-m">' + hechas + ' de ' + total + ' respondidas · ' + pct + '%</div>' +
            '<div class="progress" style="margin:8px 0"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
            '<div class="test-nav" style="margin-top:6px">' +
              '<button class="btn-pri" type="button" data-inicio-continuar="' + this.esc(s._id) + '">Continuar</button>' +
            '</div></div>';
          const b = cont.querySelector('[data-inicio-continuar]');
          if (b) b.addEventListener('click', () => this.continuarPausada(s._id));
        }
      }

      // --- repaso de falladas ---
      const nFall = this.fallosDeBanco().length;
      const tit = document.getElementById('inicio-falladas-tit');
      if (tit) tit.innerHTML = nFall
        ? 'Tienes <b>' + nFall + '</b> preguntas falladas pendientes.'
        : 'No tienes fallos pendientes.';
      const inpF = document.getElementById('inicio-n-falladas');
      if (inpF) {
        inpF.max = Math.max(1, nFall || 1);
        const v = parseInt(inpF.value, 10) || 25;
        inpF.value = Math.min(v, Math.max(1, nFall || 1));
      }

      // --- MemorIA ---
      const pend = this.pendientesHoy().length;
      const mt = document.getElementById('inicio-memoria-tit');
      if (mt) mt.innerHTML = pend
        ? '<b>' + pend + '</b> preguntas para repasar hoy.'
        : 'Nada pendiente hoy en MemorIA.';
      const mm = document.getElementById('inicio-memoria-meta');
      if (mm) {
        const mem = this.cargarMemoria();
        const total = Object.keys(mem).length;
        const dom = Object.keys(mem).map((k) => mem[k]).filter((m) => m.dominada).length;
        mm.textContent = total + ' en total · ' + dom + ' dominadas.';
      }
      const bm = document.getElementById('inicio-empezar-memoria');
      if (bm) bm.disabled = !pend;

      this.pintarResumenInicio();
    } catch (e) {
      console.error('pintarInicio', e);
    }
  },

  fallosDeBanco() {
    const marcados = new Set(this.fallos || []);
    return this.poolGlobal().filter((p) => marcados.has(this.clave(p)));
  },

  pintarResumenInicio() {
    const el = document.getElementById('resumen-inicio');
    if (!el) return;
    let ok = 0, mal = 0, vistas = 0;
    Object.keys(this.porPregunta).forEach((k) => {
      const st = this.porPregunta[k] || {};
      ok += st.ok || 0;
      mal += st.mal || 0;
      if ((st.ok || 0) + (st.mal || 0) > 0) vistas++;
    });
    const total = ok + mal;
    const pctGlobal = total > 0 ? Math.round((ok / total) * 100) : 0;
    const sesiones = this.historial.length;

    el.innerHTML =
      this.mini(this.poolGlobal().length, 'Preguntas en el pool') +
      this.mini(vistas, 'Preguntas ya vistas') +
      this.mini(pctGlobal + '%', 'Acierto acumulado', total === 0 ? '' : (pctGlobal >= 50 ? 'ok' : 'mal')) +
      this.mini(sesiones, 'Tests hechos');
  },

  mini(valor, etiqueta, clase) {
    return '<div class="mini"><div class="mini-v ' + (clase || '') + '">' + this.esc(valor) +
           '</div><div class="mini-l">' + this.esc(etiqueta) + '</div></div>';
  },

  /* ================= ajustes ================= */

  leerAjustesUI() {
    const sc = document.getElementById('set-cuenta');
    if (sc) sc.value = this.cuenta || 'senor';
    document.getElementById('set-test-n').value = this.ajustes.testN;
    document.getElementById('set-sim-n').value = this.ajustes.simN;
    document.getElementById('set-sim-min').value = this.ajustes.simMin;
    document.getElementById('set-penal').value = this.ajustes.penal;
    document.getElementById('set-correccion-inmediata').checked = !!this.ajustes.correccionInmediata;
    document.getElementById('set-barajar').checked = !!this.ajustes.barajar;
    document.getElementById('set-oscuro').checked = !!this.ajustes.oscuro;
    const sl = document.getElementById('set-letra');
    if (sl) sl.value = this.ajustes.letra || 'normal';
  },

  aplicarTema() {
    document.body.classList.toggle('dark', !!this.ajustes.oscuro);
    this.aplicarLetra();
    this.pintarCuenta();
  },

  aplicarLetra() {
    const l = this.ajustes.letra || 'normal';
    document.body.classList.toggle('fuente-grande', l === 'grande');
    document.body.classList.toggle('fuente-muygrande', l === 'muygrande');
  },

  pintarCuenta() {
    const b = document.getElementById('btn-cuenta');
    if (b) b.textContent = this.nombreCuenta();
  },

  guardarAjustesDesdeUI() {
    this.ajustes = {
      testN: Math.max(5, parseInt(document.getElementById('set-test-n').value, 10) || AJUSTES_DEF.testN),
      simN: Math.max(10, parseInt(document.getElementById('set-sim-n').value, 10) || AJUSTES_DEF.simN),
      simMin: Math.max(0, parseInt(document.getElementById('set-sim-min').value, 10) || 0),
      penal: Math.max(0, Math.min(1, parseFloat(document.getElementById('set-penal').value) || 0)),
      correccionInmediata: document.getElementById('set-correccion-inmediata').checked,
      barajar: document.getElementById('set-barajar').checked,
      oscuro: document.getElementById('set-oscuro').checked,
      letra: (document.getElementById('set-letra') || {}).value || 'normal'
    };
    this.dset('ajustes', this.ajustes);
    this.aplicarTema();
    this.pintarInicio();
  },

  abrirAjustes() {
    this.leerAjustesUI();
    const v = document.getElementById('app-version');
    if (v) v.textContent = APP_VERSION;
    document.getElementById('modal-ajustes').classList.remove('hidden');
  },

  /* Borra la cache y recarga: la via para salir de un service worker viejo. */
  async actualizarApp() {
    try {
      this.toast('Buscando actualización…');
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          try { await r.update(); } catch (e) {}
        }
      }
      if (window.caches) {
        const claves = await caches.keys();
        await Promise.all(claves.map((k) => caches.delete(k)));
      }
      setTimeout(() => location.reload(), 700);
    } catch (e) {
      console.error('actualizarApp', e);
      location.reload();
    }
  },
  cerrarAjustes() { document.getElementById('modal-ajustes').classList.add('hidden'); this.guardarAjustesDesdeUI(); },

  /* ================= sesión ================= */

  fuenteDe(p) { return (p && p.fuente === 'preparador') ? 'preparador' : 'oficial'; },

  cuentaFuentes() {
    const c = { oficial: 0, preparador: 0, conRespuesta: 0 };
    this.poolGlobal().forEach((p) => {
      if (!p.correcta) return;
      c[this.fuenteDe(p)]++;
      c.conRespuesta++;
    });
    return c;
  },

  setFiltroFuente(f) {
    this.filtroFuente = f || 'todas';
    this.dset('filtroFuente', this.filtroFuente);
    this.pintarChipsFuente();
    this.pintarInicio();
    this.pintarStats();
    this.toast(this.filtroFuente === 'todas' ? 'Tests sobre todo el banco'
      : (this.filtroFuente === 'oficial' ? 'Solo preguntas oficiales' : 'Solo material de Daniel Dorta'));
  },

  pintarChipsFuente() {
    const c = this.cuentaFuentes();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('n-ofi', c.oficial);
    set('n-pre', c.preparador);
    set('chip-total', c.conRespuesta);
    set('chip-ofi', c.oficial);
    set('chip-pre', c.preparador);
    this.$$('.fchip[data-fuente]').forEach((x) => x.classList.toggle('on', x.dataset.fuente === this.filtroFuente));
  },

  setModo(correccion) {
    this.ajustes.correccionInmediata = (correccion === 'estudio');
    this.dset('ajustes', this.ajustes);
    this.pintarSegModo();
    this.leerAjustesUI();
    if (this.sesion) {
      this.sesion.correccionInmediata = this.ajustes.correccionInmediata;
      if (this.sesion.correccionInmediata) {
        Object.keys(this.sesion.respuestas).forEach((i) => { this.sesion.corregidas[i] = true; });
      } else {
        this.sesion.corregidas = {};
      }
      this.pintarPregunta();
    }
    if (!this.sesion && this._vistaTest) this.vistaTest(this._vistaTest);
    this.toast(this.ajustes.correccionInmediata
      ? 'Modo estudio: te corrijo al responder'
      : 'Modo examen: corriges todo al final');
  },

  pintarSegModo() {
    const est = !!this.ajustes.correccionInmediata;
    this.$$('[data-correccion]').forEach((b) => {
      b.classList.toggle('on', (b.dataset.correccion === 'estudio') === est);
    });
    const chip = document.getElementById('test-modo-chip');
    if (chip) {
      chip.textContent = est ? 'Estudio' : 'Examen';
      chip.className = 'modo-chip ' + (est ? 'estudio' : 'examen');
    }
  },

  /* ================= portada del test (dos opciones) ================= */

  vistaTest(v) {
    const map = { portada: 'test-portada', config: 'vista-config', completo: 'vista-completo', examen: 'vista-examen', runner: 'test-runner' };
    if (!map[v]) v = 'portada';
    Object.keys(map).forEach((k) => {
      const el = document.getElementById(map[k]);
      if (el) el.classList.toggle('hidden', k !== v);
    });
    this._vistaTest = v;
    if (v === 'portada') this.pintarPortadaTest();
    else if (v === 'completo') this.pintarCompletos();
    else if (v === 'examen') this.pintarExamenCfg();
    else if (v === 'config') this.pintarConfig();
  },

  /* Exámenes completos, separados de los configurables. */
  pintarCompletos() {
    const el = document.getElementById('comp-lista');
    if (!el) return;
    const fuente = this._compFuente || 'oficial';
    this.$$('#comp-fuente [data-comp-fuente]').forEach((b) =>
      b.classList.toggle('on', b.dataset.compFuente === fuente));

    const exs = this.examenes().filter((x) => {
      const b = (this.bancos || []).find((bb) => bb.id === x.banco);
      const f = (b && b.fuente) ? b.fuente : 'oficial';
      return f === fuente;
    });

    if (!exs.length) {
      el.innerHTML = '<div class="mem-vacio">No hay exámenes de esa fuente todavía.' +
        (fuente === 'preparador' ? '<br>Importa un PDF desde Ajustes para añadir los de Daniel Dorta.' : '') +
        '</div>';
      return;
    }

    el.innerHTML = exs.map((x) => {
      const h = this.hechoDe(x.id);
      return '<button class="of-item" type="button" data-completo="' + this.esc(x.id) + '">' +
        '<span class="of-item-tx">' +
          '<span class="of-item-t">' + this.esc(x.titulo) + '</span>' +
          '<span class="of-item-s">' + this.esc(x.convocatoria || '') + '</span>' +
          '<span class="of-item-m">' + x.n + ' preguntas' + (x.etiqueta ? ' · ' + this.esc(x.etiqueta) : '') + '</span>' +
        '</span>' +
        (h ? '<span class="of-item-est hecho">Hecho x' + h.veces + ' · mejor ' + Number(h.mejor || 0).toFixed(2) + '</span>'
           : '<span class="of-item-est">Sin hacer</span>') +
        '</button>';
    }).join('');

    el.querySelectorAll('[data-completo]').forEach((b) =>
      b.addEventListener('click', () => this.abrirCompleto(b.dataset.completo)));
  },

  abrirCompleto(id) {
    const ex = this.examenes().find((x) => x.id === id);
    if (!ex) return;
    this.exCfg = { id, min: 0 };
    this.vistaTest('examen');
  },

  pintarPortadaTest() {
    const exs = this.examenes();
    const d = document.getElementById('desc-oficiales');
    if (d) d.textContent = exs.length + (exs.length === 1 ? ' examen disponible' : ' exámenes disponibles');
    const f = document.getElementById('desc-fallos2');
    if (f) f.textContent = this.fallosDeBanco().length + ' pendientes';
  },

  /* ================= exámenes oficiales ================= */

  examenes() {
    const meta = window.EXAMENES_META || {};
    return (this.bancos || []).map((b) => {
      const m = meta[b.id] || {};
      const n = (b.preguntas || []).filter((p) => p.correcta).length;
      const fecha = b.fecha || '';
      return {
        id: b.id,
        banco: b.id,
        titulo: b.titulo || b.id,
        convocatoria: b.convocatoria || '',
        examen: b.examen || '',
        fecha,
        anio: m.anio || (fecha ? parseInt(fecha.slice(0, 4), 10) : 0),
        etiqueta: m.etiqueta || fecha,
        nota: m.nota || '',
        minutos: (m.minutos === undefined ? null : m.minutos),
        n
      };
    }).sort((a, b) => (b.anio - a.anio) || String(a.titulo).localeCompare(String(b.titulo)));
  },

  hechoDe(id) { return this.examenesHechos[id] || null; },

  setFiltroOficiales(f) {
    this.ofFiltro = f || 'todos';
    this.pintarOficiales();
  },

  pintarOficiales() {
    const el = document.getElementById('of-lista');
    if (!el) return;
    const exs = this.examenes();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('of-hechos', exs.filter((x) => this.hechoDe(x.id)).length);
    set('of-total', exs.length);
    set('of-total-lbl', exs.length === 1 ? 'examen' : 'exámenes');

    const filtro = this.ofFiltro || 'todos';
    this.$$('[data-of-filtro]').forEach((b) => b.classList.toggle('on', b.dataset.ofFiltro === filtro));

    const vis = exs.filter((x) => filtro === 'todos' ? true : (filtro === 'hechos' ? !!this.hechoDe(x.id) : !this.hechoDe(x.id)));
    if (!vis.length) {
      el.innerHTML = '<div class="vacio">No hay exámenes que mostrar' +
        (filtro === 'hechos' ? ' (todavía no has hecho ninguno)' : '') + '.</div>';
      return;
    }

    const grupos = {};
    vis.forEach((x) => { (grupos[x.anio] = grupos[x.anio] || []).push(x); });
    let html = '';
    Object.keys(grupos).sort((a, b) => b - a).forEach((anio) => {
      const lista = grupos[anio];
      html += '<div class="of-anio"><div class="of-anio-cab"><b>' + this.esc(anio) + '</b><span>' +
        lista.length + ' examen' + (lista.length === 1 ? '' : 'es') + '</span></div>';
      html += lista.map((x) => {
        const h = this.hechoDe(x.id);
        return '<button class="of-item" type="button" data-examen="' + this.esc(x.id) + '">' +
          '<span class="of-item-tx">' +
            '<span class="of-item-t">' + this.esc(x.titulo) + '</span>' +
            '<span class="of-item-s">' + this.esc(x.convocatoria || '') + '</span>' +
            '<span class="of-item-m">' + x.n + ' preguntas' + (x.etiqueta ? ' · ' + this.esc(x.etiqueta) : '') + '</span>' +
          '</span>' +
          (h ? '<span class="of-item-est hecho">Hecho' + (h.veces > 1 ? ' x' + h.veces : '') + ' · mejor ' + (h.mejor || 0).toFixed(2) + '</span>'
             : '<span class="of-item-est">Sin hacer</span>') +
          '</button>';
      }).join('');
      html += '</div>';
    });
    el.innerHTML = html;
    el.querySelectorAll('[data-examen]').forEach((b) => {
      b.addEventListener('click', () => this.abrirExamen(b.dataset.examen));
    });
  },

  abrirExamen(id) {
    const ex = this.examenes().find((x) => x.id === id);
    if (!ex) return;
    this.exCfg = { id, min: (this.cfg && this.cfg.min) || 0 };
    this.vistaTest('examen');
  },

  pintarExamenCfg() {
    const ex = this.examenes().find((x) => x.id === ((this.exCfg || {}).id));
    if (!ex) { this.vistaTest('oficiales'); return; }
    document.getElementById('ex-titulo').textContent = ex.titulo;
    document.getElementById('ex-meta').innerHTML =
      this.esc(ex.convocatoria) + '<br>' + this.esc(ex.examen) +
      ' · <strong>' + ex.n + ' preguntas</strong>' +
      (ex.nota ? '<br>' + this.esc(ex.nota) : '') +
      (ex.minutos ? '<br>Tiempo oficial: <strong>' + ex.minutos + ' min</strong>'
                  : '<br>Tiempo oficial: <em>no confirmado en las bases</em> — elige tu');

    const est = !!this.ajustes.correccionInmediata;
    const min = est ? 0 : ((this.exCfg && this.exCfg.min) || 0);
    const cont = document.getElementById('ex-tiempos');
    if (cont) cont.classList.toggle('bloqueado', est);
    this.$$('#ex-tiempos .chip-mini').forEach((b) => {
      b.classList.toggle('on', (parseInt(b.dataset.exMin, 10) || 0) === min);
      b.disabled = est;
    });
    const nota = document.getElementById('ex-tiempo-nota');
    if (nota) nota.textContent = est
      ? 'En modo estudio no hay tiempo: es obligatorio ir sin límite.'
      : 'Cuando se acabe el tiempo, el examen se entrega solo.';

    document.getElementById('ex-resumen').innerHTML =
      '<b>' + ex.n + '</b> preguntas · ' +
      (est ? 'modo estudio, <strong>sin tiempo</strong>' : (min > 0 ? '<strong>' + min + ' min</strong>' : 'sin límite')) +
      ' · ' + this.txtPenal();
  },

  txtPenal() {
    const p = this.ajustes.penal || 0;
    if (!p) return 'sin penalización';
    const r = Math.round(1 / p);
    return r > 1 ? r + ' fallos = 1 acierto' : 'penalización 1:1';
  },

  empezarExamen() {
    const ex = this.examenes().find((x) => x.id === ((this.exCfg || {}).id));
    if (!ex) return;
    this.empezar('oficial', { examenId: ex.id, min: (this.exCfg || {}).min || 0 });
  },

  /* ================= configurador de test ================= */

  /* Bloque de una pregunta: campo explicito, ejercicio declarado o examen.
     En Tramitación: test (1er ejercicio), caso práctico (2º) e informática (3º).
     El campo `ejercicio` del banco es la fuente fiable (1/2/3). */
  bloqueDe(p) {
    if (!p) return 'test';
    if (p.bloque) return p.bloque;

    const b = (this.bancos || []).find((x) => x.id === p._banco);
    const t = ((b ? (b.examen || '') + ' ' + (b.titulo || '') : '')).toLowerCase();
    const tres = /tres ejercicios/.test(t);

    // Examen de un unico ejercicio con nombre inequivoco
    if (!tres && /word|excel|inform[aá]tica|ofim[aá]tica|tercer ejercicio/.test(t)) return 'informatica';

    const ej = parseInt(p.ejercicio, 10);
    if (ej === 2) return 'caso';
    if (ej === 3) return 'informatica';
    if (ej === 1) return 'test';

    return 'test';
  },

  /* Normaliza las etiquetas de base legal (hay 272 distintas y muy sucias). */
  normalizarLey(base) {
    let b = String(base || '').toLowerCase().trim();
    if (!b) return '';
    // Si empieza por "art. X", quedarse con lo que viene detras
    const art = b.match(/^art\.?\s*[\d.]+\s*(?:de\s+la\s+|de\s+)?(.+)$/);
    if (art && art[1] && art[1].length > 3) b = art[1];

    const reglas = [
      [/enjuiciamiento civil|ley\s*1\s*\/\s*2000|\blec\b/, 'LEC (Ley 1/2000)'],
      [/enjuiciamiento criminal|\blecrim\b/, 'LECrim'],
      [/poder judicial|\blopj\b/, 'LOPJ (LO 6/1985)'],
      [/constituci[oó]n/, 'Constitución Española'],
      [/contencioso[- ]administrativo|ley\s*29\s*\/\s*1998|\bljca\b/, 'LJCA (Ley 29/1998)'],
      [/jurisdicci[oó]n social|ley\s*36\s*\/\s*2011|\blrjs\b/, 'LRJS (Ley 36/2011)'],
      [/registro civil|ley\s*20\s*\/\s*2011/, 'Ley del Registro Civil (20/2011)'],
      [/protecci[oó]n de datos|lo\s*3\s*\/\s*2018|lo\s*15\s*\/\s*1999/, 'Protección de Datos'],
      [/procedimiento administrativo com[uú]n|ley\s*39\s*\/\s*2015|\blpac\b/, 'LPAC (Ley 39/2015)'],
      [/r[eé]gimen jur[ií]dico del sector p[uú]blico|ley\s*40\s*\/\s*2015|\blrjsp\b/, 'LRJSP (Ley 40/2015)'],
      [/contratos del sector p[uú]blico|ley\s*9\s*\/\s*2017|\blcsp\b/, 'LCSP (Ley 9/2017)'],
      [/estatuto de los trabajadores|rdleg\s*2\s*\/\s*2015/, 'Estatuto de los Trabajadores'],
      [/estatuto b[aá]sico del empleado p[uú]blico|rdleg\s*5\s*\/\s*2015|\bebep\b/, 'EBEP (RDL 5/2015)'],
      [/violencia de g[eé]nero|lo\s*1\s*\/\s*2004/, 'LO Violencia de Género'],
      [/igualdad|lo\s*3\s*\/\s*2007/, 'LO Igualdad (3/2007)'],
      [/extranjer[ií]a|lo\s*4\s*\/\s*2000/, 'LO Extranjería (4/2000)'],
      [/c[oó]digo civil/, 'Código Civil'],
      [/c[oó]digo penal/, 'Código Penal'],
      [/c[oó]digo de comercio/, 'Código de Comercio'],
      [/concursal|ley\s*22\s*\/\s*2003|trlc/, 'Ley Concursal'],
      [/jurisdicci[oó]n voluntaria|ley\s*15\s*\/\s*2015/, 'Ley 15/2015 (Jurisdicción Voluntaria)'],
      [/asistencia jur[ií]dica gratuita|ley\s*1\s*\/\s*1996/, 'Ley 1/1996 (Justicia Gratuita)'],
      [/demarcaci[oó]n y planta|ley\s*38\s*\/\s*1988/, 'Ley 38/1988 (Demarcación y Planta)'],
      [/tribunal constitucional|lo\s*2\s*\/\s*1979/, 'LOTC (LO 2/1979)'],
      [/transparencia|ley\s*19\s*\/\s*2013/, 'Ley de Transparencia (19/2013)'],
      [/contrato de trabajo|rdleg\s*2\s*\/\s*2015/, 'Estatuto de los Trabajadores']
    ];
    for (let i = 0; i < reglas.length; i++) {
      if (reglas[i][0].test(b)) return reglas[i][1];
    }

    const m = b.match(/(?:ley org[aá]nica|lo|ley)\s*(\d+)\s*\/\s*(\d{4})/);
    if (m) return 'Ley ' + m[1] + '/' + m[2];

    return 'Otras';
  },

  leyDe(p) {
    if (p && p.ley) return p.ley;
    return this.normalizarLey(p && p.base);
  },

  leyesDisponibles() {
    const cuenta = {};
    this.poolGlobal().forEach((p) => {
      const l = this.leyDe(p);
      if (!l) return;
      cuenta[l] = (cuenta[l] || 0) + 1;
    });
    return Object.keys(cuenta)
      .map((ley) => ({ ley: ley, n: cuenta[ley] }))
      .sort((a, b) => b.n - a.n);
  },

  /* Pool global filtrado por fuente, bloques, ley y examen concreto. */
  poolFiltrado() {
    const c = this.cfg || {};
    let lista = this.poolGlobal();
    const fuente = c.fuente || 'todas';
    const bloques = Array.isArray(c.bloques) ? c.bloques : ['test', 'caso', 'informatica'];
    const examen = c.examen || 'todos';
    const ley = c.ley || 'todas';

    if (fuente !== 'todas') lista = lista.filter((p) => this.fuenteDe(p) === fuente);
    if (bloques.length < 3) lista = lista.filter((p) => bloques.indexOf(this.bloqueDe(p)) !== -1);
    if (examen !== 'todos') lista = lista.filter((p) => (p._banco || '') === examen);
    if (ley !== 'todas') lista = lista.filter((p) => this.leyDe(p) === ley);
    return lista;
  },

  listaConjunto(tipo) {
    const disp = this.poolFiltrado();
    if (tipo === 'sin-hacer' || tipo === 'sin-contestar') {
      return disp.filter((p) => {
        const s = this.porPregunta[this.clave(p)];
        return !s || ((s.ok || 0) + (s.mal || 0)) === 0;
      });
    }
    if (tipo === 'falladas') return disp.filter((p) => this.fallos.includes(this.clave(p)));
    if (tipo === 'muy-falladas') {
      return disp.filter((p) => {
        const s = this.porPregunta[this.clave(p)];
        return !!s && (s.mal || 0) > UMBRAL_MUY_FALLADAS;
      });
    }
    return disp;
  },

  contarConjunto(tipo) { return this.listaConjunto(tipo).length; },

  muyFalladasDeBanco() {
    return this.poolGlobal().filter((p) => {
      const st = this.porPregunta[this.clave(p)];
      return !!st && (st.mal || 0) > UMBRAL_MUY_FALLADAS;
    }).length;
  },

  setCfg(k, v) {
    this.cfg[k] = v;
    this.dset('cfg', this.cfg);
    this.pintarConfig();
  },

  pintarConfig() {
    if (!this.cfg) this.cfg = Object.assign({ n: 25, min: 0 }, this.dget('cfg', {}) || {});
    this.cfg.fuente = this.cfg.fuente || 'todas';
    if (!Array.isArray(this.cfg.bloques) || !this.cfg.bloques.length) {
      this.cfg.bloques = ['test', 'caso', 'informatica'];
    }
    this.cfg.tipo = this.cfg.tipo || 'todas';
    this.cfg.examen = this.cfg.examen || 'todos';
    this.cfg.ley = this.cfg.ley || 'todas';

    const est = !!this.ajustes.correccionInmediata;
    const max = this.contarConjunto(this.cfg.tipo) || 0;

    // Selector de examen concreto
    const selEx = document.getElementById('cfg-examen');
    if (selEx) {
      const opts = ['<option value="todos">Todo el banco (todos los exámenes)</option>']
        .concat((this.bancos || []).map((b) =>
          '<option value="' + this.esc(b.id) + '">' + this.esc(b.titulo || b.id) + '</option>'));
      selEx.innerHTML = opts.join('');
      selEx.value = this.cfg.examen;
    }

    const inp = document.getElementById('cfg-n');
    if (inp) {
      inp.max = Math.max(1, max);
      inp.value = Math.min(this.cfg.n || 1, Math.max(1, max));
    }
    const not = document.getElementById('cfg-n-nota');
    if (not) not.textContent = max
      ? 'Hay ' + max + ' preguntas con estos filtros.'
      : 'No hay preguntas con estos filtros.';

    const min = est ? 0 : (this.cfg.min || 0);
    const cont = document.getElementById('cfg-tiempos');
    if (cont) cont.classList.toggle('bloqueado', est);
    this.$$('#cfg-tiempos .chip-mini').forEach((b) => {
      b.classList.toggle('on', (parseInt(b.dataset.cfgMin, 10) || 0) === min);
      b.disabled = est;
    });
    const nt = document.getElementById('cfg-tiempo-nota');
    if (nt) nt.textContent = est
      ? 'En modo estudio no hay tiempo: es obligatorio ir sin límite.'
      : 'Cuando se acabe el tiempo, el test se entrega solo.';

    this.$$('#cfg-fuente [data-fuente]').forEach((b) => b.classList.toggle('on', b.dataset.fuente === this.cfg.fuente));
    this.$$('#cfg-bloque [data-bloque]').forEach((b) =>
      b.classList.toggle('on', this.cfg.bloques.indexOf(b.dataset.bloque) !== -1));
    this.$$('#cfg-tipo [data-tipo]').forEach((b) => b.classList.toggle('on', b.dataset.tipo === this.cfg.tipo));

    const bn = document.getElementById('cfg-bloque-nota');
    if (bn) bn.textContent = this.cfg.bloques.length === 3
      ? 'Marcados los tres: entran preguntas de cualquier bloque.'
      : 'Entran solo: ' + this.txtBloque() + '.';

    const selLey = document.getElementById('cfg-ley');
    if (selLey) {
      const leyes = this.leyesDisponibles();
      const opts = ['<option value="todas">Todas las leyes</option>']
        .concat(leyes.map((x) => '<option value="' + this.esc(x.ley) + '">' +
          this.esc(x.ley) + ' (' + x.n + ')</option>'));
      selLey.innerHTML = opts.join('');
      selLey.value = this.cfg.ley;
    }

    const nEf = max ? Math.max(1, Math.min(this.cfg.n || max, max)) : 0;
    const res = document.getElementById('cfg-resumen');
    if (res) {
      res.innerHTML = nEf
        ? '<b>' + nEf + '</b> pregunta' + (nEf === 1 ? '' : 's') + ' · ' +
          (est ? 'estudio, <strong>sin tiempo</strong>' : (min > 0 ? '<strong>' + min + ' min</strong>' : 'sin límite')) +
          ' · ' + this.txtFuente() + ' · ' + this.txtBloque() + ' · ' + this.txtTipo() +
          (this.cfg.ley && this.cfg.ley !== 'todas' ? ' · ' + this.txtLey() : '')
        : 'No hay preguntas disponibles con esa combinación.';
    }
    const go = document.getElementById('cfg-empezar');
    if (go) go.disabled = !nEf;
  },

  txtFuente() {
    return { todas: 'todas las fuentes', oficial: 'oficiales', preparador: 'Daniel Dorta' }[this.cfg.fuente] || '';
  },

  txtBloque() {
    const nombres = { test: 'test', caso: 'caso práctico', informatica: 'informática' };
    const b = Array.isArray(this.cfg.bloques) ? this.cfg.bloques : [];
    if (b.length === 3) return 'todos los bloques';
    return b.map((x) => nombres[x] || x).join(' + ');
  },

  txtLey() {
    return (this.cfg.ley && this.cfg.ley !== 'todas') ? this.cfg.ley : 'todas las leyes';
  },

  txtTipo() {
    return { todas: 'todas', falladas: 'falladas', 'sin-hacer': 'no realizadas' }[this.cfg.tipo] || '';
  },

  empezarConfig() {
    this.empezar('config', {});
  },

  /* ================= recuento por pregunta ================= */

  contarEnSesion(i, acierto, blanco) {
    const s = this.sesion;
    if (!s) return;
    const p = s.preguntas[i];
    if (!p) return;
    const k = this.clave(p);
    const st = this.porPregunta[k] = this.porPregunta[k] || { ok: 0, mal: 0, bl: 0 };
    if (blanco) {
      st.bl = (st.bl || 0) + 1;
    } else if (acierto) {
      st.ok = (st.ok || 0) + 1;
      this.fallos = this.fallos.filter((f) => f !== k);
    } else {
      st.mal = (st.mal || 0) + 1;
      if (!this.fallos.includes(k)) this.fallos.push(k);
      // Al tercer fallo acumulado la pregunta entra sola en MemorIA.
      if ((st.mal || 0) >= 3 && !this.enMemoria(k)) {
        this.memorizar(p, 'auto');
        this.toast('Entra en MemorIA: 3 fallos');
      }
    }
    s.contadas = s.contadas || {};
    s.contadas[i] = true;
    this.registrarActividad(1);
    this.dset('porPregunta', this.porPregunta);
    this.dset('fallos', this.fallos);
  },

  abrirMenu() {
    const s = document.getElementById('sidebar'), v = document.getElementById('velo');
    if (s) s.classList.add('abierto');
    if (v) v.classList.add('visible');
  },

  cerrarMenu() {
    const s = document.getElementById('sidebar'), v = document.getElementById('velo');
    if (s) s.classList.remove('abierto');
    if (v) v.classList.remove('visible');
  },

  preguntasDisponibles() {
    let lista = this.poolGlobal();
    if (this.filtroFuente && this.filtroFuente !== 'todas') {
      lista = lista.filter((p) => this.fuenteDe(p) === this.filtroFuente);
    }
    return lista;
  },

  pintarNav() {
    const nav = document.getElementById('question-nav');
    const s = this.sesion;
    if (!nav || !s) return;
    let okC = 0, malC = 0, blC = 0, html = '';
    s.preguntas.forEach((p, i) => {
      const r = s.respuestas[i];
      const corr = !!s.corregidas[i];
      let cls;
      if (!r) { blC++; cls = 'blanco'; }
      else if (corr) {
        if (r === p.correcta) { okC++; cls = 'correcta'; } else { malC++; cls = 'incorrecta'; }
      } else { cls = 'respondida'; }
      if (i === s.idx) cls += ' actual';
      html += '<button type="button" class="question-btn ' + cls + '" data-ir="' + i + '">' + (i + 1) + '</button>';
    });
    nav.innerHTML = html;
    nav.querySelectorAll('[data-ir]').forEach((b) => {
      b.addEventListener('click', () => this.irA(parseInt(b.dataset.ir, 10)));
    });
    this.pintarAFB(okC, malC, blC, s.preguntas.length);
  },

  pintarAFB(ok, mal, blanco, total) {
    const w = (id, v) => { const e = document.getElementById(id); if (e) e.style.width = (total > 0 ? (v / total * 100) : 0) + '%'; };
    w('afb-ok', ok); w('afb-mal', mal); w('afb-bl', blanco);
    const t = document.getElementById('afb-txt');
    if (t) t.textContent = ok + ' aciertos · ' + mal + ' fallos · ' + blanco + ' en blanco';
  },

  empezar(modo, opts) {
    opts = opts || {};
    if (!this.banco) { this.toast('No hay banco cargado'); return; }
    const disp = this.preguntasDisponibles();
    if (!disp.length) { this.toast('No hay preguntas de esa fuente todavía'); return; }
    let lista = [];

    if (modo === 'fallos' || modo === 'fallos-sesion') {
      if (modo === 'fallos') {
        lista = this.fallosDeBanco();
      } else {
        lista = (this._ultimosFallos || []);
      }
      if (!lista.length) { this.toast('No hay fallos pendientes en este banco'); return; }
      lista = lista.slice();
    } else if (modo === 'rango') {
      const desde = parseInt(prompt('Primera pregunta (número del examen):', '1'), 10);
      const hasta = parseInt(prompt('Última pregunta:', String(disp.length)), 10);
      if (!desde || !hasta) return;
      lista = disp.filter((p) => p.n >= desde && p.n <= hasta);
      if (!lista.length) { this.toast('Ese rango no tiene preguntas'); return; }
    } else if (modo === 'oficial') {
      const ex = this.examenes().find((x) => x.id === (opts.examenId || (this.exCfg || {}).id));
      if (!ex) { this.toast('Ese examen no está cargado'); return; }
      const b = this.bancos.find((x) => x.id === ex.banco);
      if (!b) { this.toast('Falta el banco de ese examen'); return; }
      this.banco = b;
      this.filtroFuente = 'todas';
      this.pintarChipsFuente();
      lista = b.preguntas.filter((p) => p.correcta).slice();
      this.exTitulo = ex.titulo;
      this.exId = ex.id;
      if (!lista.length) { this.toast('Ese examen no tiene preguntas con respuesta oficial'); return; }
    } else if (modo === 'config') {
      const base = this.listaConjunto(this.cfg.tipo);
      if (!base.length) {
        this.toast(this.cfg.tipo === 'falladas'
          ? 'No tienes fallos pendientes con esos filtros'
          : (this.cfg.tipo === 'sin-hacer' ? 'No quedan preguntas sin hacer con esos filtros'
            : 'No hay preguntas con esos filtros'));
        return;
      }
      const n = Math.max(1, Math.min(this.cfg.n || base.length, base.length));
      lista = (this.ajustes.barajar ? this.barajar(base) : base.slice()).slice(0, n);
    } else {
      const n = modo === 'simulacro' ? this.ajustes.simN : this.ajustes.testN;
      const base = this.ajustes.barajar ? this.barajar(disp) : disp.slice();
      lista = base.slice(0, Math.min(n, base.length));
    }

    if (this.ajustes.barajar && modo !== 'rango' && (modo === 'fallos' || modo === 'fallos-sesion')) {
      lista = this.barajar(lista);
    }

    const est = !!this.ajustes.correccionInmediata;
    const minutos = est ? 0
      : (modo === 'simulacro' ? this.ajustes.simMin
        : (modo === 'config' ? (this.cfg.min || 0)
          : (modo === 'oficial' ? (opts.min || 0) : 0)));

    this.sesion = {
      bancoId: this.banco.id,
      modo,
      titulo: modo === 'oficial' ? (this.exTitulo || 'Examen oficial')
        : (modo === 'config' ? 'Test personalizado' : ''),
      examenId: modo === 'oficial' ? (this.exId || null) : null,
      preguntas: lista.map((p) => ({ n: p.n, _banco: p._banco || this.banco.id, ejercicio: p.ejercicio || 1, enunciado: p.enunciado, opciones: p.opciones, correcta: p.correcta, reserva: !!p.reserva, fuente: this.fuenteDe(p), justificacion: p.justificacion || '', base: p.base || '' })),
      respuestas: {},
      corregidas: {},
      contadas: {},
      descartadas: {},
      idx: 0,
      inicio: Date.now(),
      fin: null,
      minutos,
      penal: this.ajustes.penal,
      correccionInmediata: est,
      tiempo: 0
    };
    this.exTitulo = null;
    this.exId = null;

    this._irRunner = true;
    this.guardarSesion();
    this.arrancarCrono();
    this.pintarPregunta();
    this.mostrarTab('tab-test');
  },

  guardarSesion() {
    if (this.sesion) this.dset('sesion', this.sesion);
  },

  arrancarCrono() {
    clearInterval(this._timer);
    const s = this.sesion;
    if (!s) return;
    const el = document.getElementById('test-cronometro');
    if (s.minutos > 0) {
      el.classList.remove('hidden');
      this._cronoFin = s.inicio + s.minutos * 60000;
    } else {
      el.classList.remove('hidden'); // en simulacro sin límite seguimos mostrando tiempo transcurrido
      this._cronoFin = 0;
    }
    this._timer = setInterval(() => {
      if (!this.sesion) return;
      if (this._cronoFin > 0) {
        const resta = (this._cronoFin - Date.now()) / 1000;
        el.textContent = this.mmss(resta);
        el.style.color = resta < 60 ? 'var(--mal)' : '';
        if (resta <= 0) { this.finalizar(true); }
      } else {
        el.textContent = this.mmss((Date.now() - this.sesion.inicio) / 1000);
      }
    }, 500);
  },

  /* ================= supuesto de hecho del caso práctico =================
     Las preguntas de caso (2º ejercicio) no se entienden sin el supuesto.
     El texto oficial va en datos/casos.js, indexado por id de banco. */

  casoDe(p) {
    const id = p && p._banco;
    if (!id) return '';
    // El supuesto solo se muestra en las preguntas del 2º ejercicio
    if (this.bloqueDe(p) !== 'caso') return '';
    const m = (typeof window !== 'undefined' && window.CASOS) || {};
    return m[id] || '';
  },

  pintarCaso(p) {
    const box = document.getElementById('caso-box');
    const txt = document.getElementById('caso-texto');
    if (!box || !txt) return;
    const caso = this.casoDe(p);
    if (!caso) {
      box.classList.add('hidden');
      box.classList.remove('abierto');
      txt.classList.add('hidden');
      txt.textContent = '';
      return;
    }
    box.classList.remove('hidden');
    txt.textContent = caso;
    const abierto = !!this._casoAbierto;
    box.classList.toggle('abierto', abierto);
    txt.classList.toggle('hidden', !abierto);
  },

  toggleCaso() {
    const box = document.getElementById('caso-box');
    const txt = document.getElementById('caso-texto');
    if (!box || !txt) return;
    this._casoAbierto = !this._casoAbierto;
    box.classList.toggle('abierto', this._casoAbierto);
    txt.classList.toggle('hidden', !this._casoAbierto);
  },

  pintarPregunta() {
    try {
      const s = this.sesion;
      if (!s) return;
      const p = s.preguntas[s.idx];
      if (!p) return;

      document.getElementById('test-progreso-txt').textContent = (s.idx + 1) + ' / ' + s.preguntas.length;
      document.getElementById('test-progress-bar').style.width = ((s.idx + 1) / s.preguntas.length * 100) + '%';

      const esPre = (p.fuente === 'preparador');
      const est = this.porPregunta[this.clave(p)];   // el pool reúne todos los exámenes: la clave lleva el banco de origen
      let hist = '';
      if (est && ((est.ok || 0) + (est.mal || 0)) > 0) {
        hist = ' <span class="hist-chip' + ((est.mal || 0) > UMBRAL_MUY_FALLADAS ? ' muy' : '') + '">' +
          'Aciertos ' + (est.ok || 0) + ' · Fallos ' + (est.mal || 0) + '</span>';
      }
      document.getElementById('pregunta-num').innerHTML =
        'Pregunta ' + (s.idx + 1) + ' · ' + (esPre ? 'Material del preparador' : 'Examen nº ' + p.n) +
        (p.reserva ? ' (reserva)' : '') +
        ' <span class="badge ' + (esPre ? 'pre' : 'ofi') + '">' + (esPre ? 'Daniel Dorta' : 'Oficial') + '</span>' + hist;

      document.getElementById('pregunta-enunciado').textContent = p.enunciado;
      this.pintarCaso(p);

      const cont = document.getElementById('opciones');
      cont.innerHTML = '';
      const elegida = s.respuestas[s.idx];
      const corregida = !!s.corregidas[s.idx];

      const descartadas = (s.descartadas && s.descartadas[s.idx]) || {};
      ['a', 'b', 'c', 'd'].forEach((l) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'opcion';
        btn.dataset.letra = l;

        if (corregida) {
          btn.classList.add('bloqueada');
          if (l === p.correcta) btn.classList.add('correcta');
          else if (l === elegida) btn.classList.add('incorrecta');
        } else if (l === elegida) {
          btn.classList.add('elegida');
        }
        if (!corregida && descartadas[l]) btn.classList.add('descartada');

        btn.innerHTML = '<span class="letra">' + l + '</span><span class="texto">' + this.esc(p.opciones[l] || '') + '</span>';
        btn.addEventListener('click', () => this.responder(l));

        if (!corregida) {
          const x = document.createElement('span');
          x.className = 'opcion-x';
          x.textContent = descartadas[l] ? '↺' : '✕';
          x.title = descartadas[l] ? 'Recuperar esta opción' : 'Descartar esta opción';
          x.setAttribute('role', 'button');
          x.addEventListener('click', (ev) => { ev.stopPropagation(); this.descartar(l); });
          btn.appendChild(x);
        }

        cont.appendChild(btn);
      });

      // marcador en vivo
      let ok = 0, mal = 0, hechas = 0;
      Object.keys(s.respuestas).forEach((i) => {
        hechas++;
        if (s.corregidas[i]) {
          if (s.respuestas[i] === s.preguntas[i].correcta) ok++; else mal++;
        }
      });
      const marc = document.getElementById('test-marcador');
      if (s.correccionInmediata) {
        marc.innerHTML = '<span class="ok">' + ok + ' ✓</span> · <span class="mal">' + mal + ' ✗</span>';
      } else {
        marc.textContent = hechas + ' respondidas';
      }

      // feedback
      const fb = document.getElementById('feedback');
      if (corregida) {
        fb.classList.remove('hidden');
        const textoBien = p.opciones[p.correcta] || '';
        if (!elegida) {
          fb.className = 'feedback mal';
          fb.textContent = 'En blanco. La correcta es la ' + p.correcta.toUpperCase() + ' — ' + textoBien + '.';
        } else {
          const acierto = elegida === p.correcta;
          fb.className = 'feedback ' + (acierto ? 'ok' : 'mal');
          fb.textContent = acierto
            ? 'Correcta.'
            : 'Incorrecta. La correcta es la ' + p.correcta.toUpperCase() + ' — ' + textoBien + '.';
        }
        this.pintarJustificacion(p);
      } else {
        fb.classList.add('hidden');
        this.pintarJustificacion(null);
      }

      this.pintarNav();

      document.getElementById('btn-anterior').disabled = s.idx === 0;
      const ultima = s.idx === s.preguntas.length - 1;
      document.getElementById('btn-siguiente').textContent = ultima ? 'Ver resultados' : 'Siguiente';
      this.pintarBotonMemorizar();
    } catch (e) {
      console.error('pintarPregunta', e);
    }
  },

  pintarJustificacion(p) {
    const j = document.getElementById('justificacion');
    if (!j) return;
    if (!p) { j.classList.add('hidden'); j.innerHTML = ''; return; }
    const txt = p.justificacion || '';
    j.classList.remove('hidden');
    if (!txt) {
      j.innerHTML = '<div class="just-tit">Base legal</div>' +
        '<div class="just-txt vacio">Pendiente de justificar: esta pregunta aun no tiene la base legal cargada.</div>';
      return;
    }
    j.innerHTML = '<div class="just-tit">' + (p.base ? 'Base legal · ' + this.esc(p.base) : 'Por que esta es la correcta') + '</div>' +
      '<div class="just-txt">' + this.esc(txt) + '</div>';
  },

  setRevFiltro(f) {
    this._revFiltro = f || 'todas';
    this.$$('#rev-filtros [data-rev]').forEach((b) => b.classList.toggle('on', b.dataset.rev === this._revFiltro));
    const cont = document.getElementById('lista-revision');
    if (cont && !cont.classList.contains('hidden')) this.toggleRevision(true);
  },

  toggleRevision(forzar) {
    const cont = document.getElementById('lista-revision');
    const btn = document.getElementById('btn-revision');
    const s = this._ultimaSesion;
    if (!cont || !btn || !s) return;
    if (!forzar && !cont.classList.contains('hidden')) {
      cont.classList.add('hidden');
      btn.textContent = 'Mostrar todas las preguntas';
      return;
    }
    const filtro = this._revFiltro || 'todas';
    let html = '';
    let n = 0;
    s.preguntas.forEach((p, i) => {
      const r = s.respuestas[i];
      const tipo = !r ? 'blanca' : (r === p.correcta ? 'acertada' : 'fallada');
      if (filtro === 'falladas' && tipo !== 'fallada') return;
      if (filtro === 'blancas' && tipo !== 'blanca') return;
      if (filtro === 'acertadas' && tipo !== 'acertada') return;
      n++;
      const cls = tipo === 'blanca' ? 'bl' : (tipo === 'acertada' ? 'ok' : 'mal');
      const est = tipo === 'blanca' ? 'En blanco' : (tipo === 'acertada' ? 'Correcta' : 'Fallada');
      const pre = (p.fuente === 'preparador');
      html += '<div class="rev ' + cls + '">' +
        '<div class="rev-cab"><span class="rev-num">' + (i + 1) + '</span>' +
        '<span class="rev-est">' + est + '</span>' +
        '<span class="badge ' + (pre ? 'pre' : 'ofi') + '">' + (pre ? 'Daniel Dorta' : 'Oficial') + '</span></div>' +
        '<div class="rev-enun">' + this.esc(p.enunciado) + '</div>' +
        (this.casoDe(p) ? '<details class="caso-rev"><summary>Supuesto de hecho del caso</summary><div>' +
          this.esc(this.casoDe(p)) + '</div></details>' : '') +
        (r && r !== p.correcta ? '<div class="rev-tu">Tu respuesta: ' + r.toUpperCase() + ' — ' + this.esc(p.opciones[r] || '') + '</div>' : '') +
        (tipo === 'blanca' ? '<div class="rev-tu">No contestada</div>' : '') +
        '<div class="rev-ok">Correcta: ' + p.correcta.toUpperCase() + ' — ' + this.esc(p.opciones[p.correcta] || '') + '</div>' +
        (p.justificacion ? '<div class="rev-just"><b>' + this.esc(p.base || 'Base legal') + '</b> ' + this.esc(p.justificacion) + '</div>'
                         : '<div class="rev-just">Sin justificacion cargada.</div>') +
        '</div>';
    });
    cont.innerHTML = html || '<div class="rev-vacio">No hay preguntas en ese filtro.</div>';
    cont.classList.remove('hidden');
    btn.textContent = 'Ocultar la revision (' + n + ')';
  },

  responder(letra) {
    const s = this.sesion;
    if (!s) return;
    if (s.correccionInmediata && s.corregidas[s.idx]) return;

    if (s.descartadas) delete s.descartadas[s.idx];
    s.respuestas[s.idx] = letra;
    if (s.correccionInmediata) {
      s.corregidas[s.idx] = true;
      this.contarEnSesion(s.idx, letra === s.preguntas[s.idx].correcta, false);
      this.guardarSesion();
      this.pintarPregunta();
      return;
    }
    this.guardarSesion();
    this.pintarPregunta();
  },

  /* Tachar una opcion sin responderla (dudar entre dos y descartar el resto). */
  descartar(letra) {
    const s = this.sesion;
    if (!s) return;
    if (s.correccionInmediata && s.corregidas[s.idx]) return;
    s.descartadas = s.descartadas || {};
    const d = s.descartadas[s.idx] = s.descartadas[s.idx] || {};
    if (d[letra]) delete d[letra]; else d[letra] = true;
    // Si estaba elegida y la tachas, se retira la respuesta.
    if (d[letra] && s.respuestas[s.idx] === letra) delete s.respuestas[s.idx];
    this.guardarSesion();
    this.pintarPregunta();
  },

  blanco() {
    const s = this.sesion;
    if (!s) return;
    if (s.correccionInmediata && s.corregidas[s.idx]) return;
    if (s.descartadas) delete s.descartadas[s.idx];
    s.respuestas[s.idx] = '';
    if (s.correccionInmediata) {
      s.corregidas[s.idx] = true;
      this.contarEnSesion(s.idx, false, true);
    }
    this.guardarSesion();
    this.pintarPregunta();
  },

  irA(i) {
    const s = this.sesion;
    if (!s) return;
    if (i < 0 || i >= s.preguntas.length) return;
    s.idx = i;
    this.guardarSesion();
    this.pintarPregunta();
  },

  siguiente() {
    const s = this.sesion;
    if (!s) return;
    if (s.idx >= s.preguntas.length - 1) { this.finalizar(false); return; }
    this.irA(s.idx + 1);
  },

  anterior() { if (this.sesion) this.irA(this.sesion.idx - 1); },

  abandonar() {
    this.confirmar(
      '¿Salir sin guardar este test? No contará en tus estadísticas.',
      'Salir sin guardar',
      () => {
        clearInterval(this._timer);
        this.sesion = null;
        this.ddel('sesion');
        this._mostrarTab('tab-inicio');
        this.pintarInicio();
      },
      null,
      'Salir sin guardar',
      'Seguir en el test'
    );
  },

  finalizar(auto) {
    const s = this.sesion;
    if (!s) return;
    if (auto) { this._finalizar(true); return; }

    const blancas = s.preguntas.filter((p, i) =>
      s.respuestas[i] === undefined || s.respuestas[i] === '').length;

    if (blancas > 0) {
      this.confirmar(
        'Te quedan ' + blancas + ' pregunta' + (blancas === 1 ? '' : 's') +
        ' sin responder. Puedes ir a la primera o entregar igualmente.',
        'Quedan preguntas en blanco',
        () => this._finalizar(false),
        () => this._irAPrimeraBlanca(),
        'Entregar igual',
        'Ir a la primera'
      );
      return;
    }
    this._finalizar(false);
  },

  _finalizar(auto) {
    const s = this.sesion;
    if (!s) return;
    clearInterval(this._timer);
    s.fin = Date.now();
    s.tiempo = Math.round((s.fin - s.inicio) / 1000);

    const res = { ok: 0, mal: 0, blanco: 0, fallos: [], detalles: [] };
    s.contadas = s.contadas || {};
    s.preguntas.forEach((p, i) => {
      const r = s.respuestas[i];
      // En modo estudio ya se contabilizo al responder: no se cuenta dos veces.
      const yaContada = !!s.contadas[i];
      if (!r) {
        res.blanco++;
        if (!yaContada) this.contarEnSesion(i, false, true);
      } else if (r === p.correcta) {
        res.ok++;
        if (!yaContada) this.contarEnSesion(i, true, false);
      } else {
        res.mal++;
        if (!yaContada) this.contarEnSesion(i, false, false);
        res.fallos.push({ n: p.n, enunciado: p.enunciado, tu: r, correcta: p.correcta, justificacion: p.justificacion || '', base: p.base || '' });
      }
    });

    const total = s.preguntas.length;
    const nota = Math.max(0, (res.ok - s.penal * res.mal) / total * 10);
    res.total = total;
    res.nota = Math.round(nota * 100) / 100;
    res.pct = this.pct(res.ok, total);
    res.fecha = new Date().toISOString();
    res.modo = s.modo;
    res.bancoId = s.bancoId;
    res.tiempo = s.tiempo;
    res.titulo = s.titulo || '';
    res.examenId = s.examenId || null;

    res.fallosClaves = s.preguntas
      .filter((p, i) => s.respuestas[i] && s.respuestas[i] !== p.correcta)
      .map((p) => this.clave(p));

    this.historial.push(res);
    if (this.historial.length > 300) this.historial = this.historial.slice(-300);

    this.dset('historial', this.historial);
    this.dset('porPregunta', this.porPregunta);
    this.dset('fallos', this.fallos);

    // Recuento por examen oficial: veces hechos y mejor nota (para la lista de "Exámenes oficiales").
    if (s.examenId) {
      const h = this.examenesHechos[s.examenId] || { veces: 0, mejor: 0, ultima: null };
      h.veces = (h.veces || 0) + 1;
      h.mejor = Math.max(h.mejor || 0, res.nota);
      h.ultima = res.fecha;
      this.examenesHechos[s.examenId] = h;
      this.dset('examenesHechos', this.examenesHechos);
    }

    // MemorIA: cuenta el repaso del dia y saca la pregunta si llega a 5 dias.
    if (s.modo === 'memoria') {
      s.preguntas.forEach((p, i) => {
        this.registrarRepaso(this.clave(p), s.respuestas[i] === p.correcta);
      });
      this.pintarMemoria();
    }

    this.ddel('sesion');

    this._ultimosFallos = s.preguntas.filter((p, i) => s.respuestas[i] && s.respuestas[i] !== p.correcta);
    this._ultimaSesion = s;
    this._ultimoRes = res;

    this.sesion = null;
    this.pintarResultados();
    this.mostrarTab('tab-resultados');
    this.pintarInicio();
    this.pintarStats();
  },

  pintarResultados() {
    try {
      const res = this._ultimoRes;
      if (!res) return;
      const elNota = document.getElementById('resultado-nota');
      elNota.textContent = res.nota.toFixed(2);
      elNota.className = 'nota ' + (res.pct >= 50 ? 'ok' : 'mal');

      document.getElementById('resultado-titulo').textContent =
        res.ok + ' acierto' + (res.ok === 1 ? '' : 's') + ' · ' +
        res.mal + ' fallo' + (res.mal === 1 ? '' : 's') + ' · ' +
        res.blanco + ' en blanco';
      document.getElementById('resultado-detalle').innerHTML =
        'Acierto: <strong>' + res.pct + '%</strong> · Tiempo: ' + this.mmss(res.tiempo) +
        '<br>Nota orientativa sobre 10' + (this._ultimaSesion && this._ultimaSesion.penal > 0
          ? ' (con penalización de ' + this._ultimaSesion.penal + ' por fallo)' : ' (sin penalización)') + '.';

      // Mensaje de racha: compara esta nota con la media de las anteriores.
      const rachaEl = document.getElementById('resultado-racha');
      if (rachaEl) {
        const h = this.historial;
        const actual = h[h.length - 1] || res;
        const previas = h.slice(Math.max(0, h.length - 6), h.length - 1);
        rachaEl.className = 'racha hidden';
        rachaEl.textContent = '';
        if (previas.length >= 3) {
          const media = previas.reduce((a, r) => a + (r.nota || 0), 0) / previas.length;
          const dif = (actual.nota || 0) - media;
          if (dif > 0.2) {
            rachaEl.className = 'racha sube';
            rachaEl.textContent = 'Vas en racha: esta nota sube ' + dif.toFixed(2) +
              ' puntos sobre tu media de las últimas ' + previas.length + ' pruebas.';
          } else if (dif < -0.2) {
            rachaEl.className = 'racha baja';
            rachaEl.textContent = 'Esta nota baja ' + Math.abs(dif).toFixed(2) +
              ' puntos respecto a tu media reciente. Repasa los fallos antes de la siguiente.';
          } else {
            rachaEl.className = 'racha';
            rachaEl.textContent = 'Vas estable: misma franja que tus últimas ' + previas.length + ' pruebas.';
          }
        }
      }

      // La revision arranca siempre en "todas".
      this._revFiltro = 'todas';
      this.$$('#rev-filtros [data-rev]').forEach((b) => b.classList.toggle('on', b.dataset.rev === 'todas'));

      const tot = res.total || 1;
      const wo = document.getElementById('res-afb-ok');
      const wm = document.getElementById('res-afb-mal');
      const wb = document.getElementById('res-afb-bl');
      if (wo) {
        wo.style.width = (res.ok / tot * 100) + '%';
        wm.style.width = (res.mal / tot * 100) + '%';
        wb.style.width = (res.blanco / tot * 100) + '%';
      }

      const cont = document.getElementById('lista-fallos');
      cont.innerHTML = '';
      if (!res.fallos.length) {
        cont.innerHTML = '<div class="vacio">Ningún fallo. Enhorabuena.</div>';
      } else {
        res.fallos.forEach((f) => {
          const d = document.createElement('div');
          d.className = 'fallo';
          d.innerHTML = '<div class="fallo-num">Pregunta ' + f.n + '</div>' +
            '<div class="fallo-enun">' + this.esc(f.enunciado) + '</div>' +
            '<div class="fallo-tu">Tu respuesta: ' + f.tu.toUpperCase() + '</div>' +
            '<div class="fallo-ok">Correcta: ' + f.correcta.toUpperCase() + '</div>' +
            (f.justificacion ? '<div class="fallo-just"><b>' + this.esc(f.base || 'Base legal') + '</b> ' + this.esc(f.justificacion) + '</div>' : '');
          cont.appendChild(d);
        });
      }
      document.getElementById('btn-repetir-fallos').classList.toggle('hidden', !res.fallos.length);
    } catch (e) {
      console.error('pintarResultados', e);
    }
  },

  /* ================= lista de tests (terminados y a medias) ================= */

  setHistFiltro(f) {
    this._histFiltro = f || 'todos';
    this.$$('#hist-filtros [data-hist]').forEach((b) => b.classList.toggle('on', b.dataset.hist === this._histFiltro));
    this.pintarListaTests();
  },

  pintarListaTests() {
    const el = document.getElementById('lista-tests');
    if (!el) return;

    const pausadas = (this.dget('pausadas', []) || []).map((s) => ({
      tipo: 'abierto',
      id: s._id,
      fecha: s._guardada || new Date(s.inicio || Date.now()).toISOString(),
      modo: s.modo,
      titulo: s.titulo || '',
      hechas: Object.keys(s.respuestas || {}).length,
      total: (s.preguntas || []).length
    }));

    const terminados = (this.historial || []).map((r) => ({
      tipo: 'terminado',
      id: r.fecha,
      fecha: r.fecha,
      modo: r.modo,
      titulo: r.titulo || '',
      ok: r.ok || 0, mal: r.mal || 0, blanco: r.blanco || 0,
      total: r.total || 0, nota: r.nota, pct: r.pct || 0,
      fallosClaves: r.fallosClaves || []
    }));

    const f = this._histFiltro || 'todos';
    let lista = f === 'abiertos' ? pausadas : (f === 'terminados' ? terminados : pausadas.concat(terminados));
    lista = lista.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

    if (!lista.length) {
      el.innerHTML = '<div class="mem-vacio">' +
        (f === 'abiertos' ? 'No tienes ningún test a medias.' :
         f === 'terminados' ? 'Todavía no has terminado ningún test.' :
         'Aún no hay tests. Empieza uno desde la pestaña Test.') + '</div>';
      return;
    }

    const nombres = {
      simulacro: 'Simulacro', test: 'Test rápido', rango: 'Por rango',
      fallos: 'Repaso de fallos', 'fallos-sesion': 'Fallos de la sesión',
      config: 'Test personalizado', oficial: 'Examen oficial', memoria: 'MemorIA'
    };

    el.innerHTML = lista.map((x) => {
      const nombre = x.titulo || nombres[x.modo] || 'Test';
      const fecha = this.fechaCorta(x.fecha);

      if (x.tipo === 'abierto') {
        const pct = x.total ? Math.round((x.hechas / x.total) * 100) : 0;
        return '<div class="test-item abierto">' +
          '<div class="test-item-cab"><span class="test-badge abierto">A medias</span>' +
          '<span class="test-item-fecha">' + fecha + '</span></div>' +
          '<div class="test-item-t">' + this.esc(nombre) + '</div>' +
          '<div class="test-item-m">' + x.hechas + ' de ' + x.total + ' respondidas · ' + pct + '%</div>' +
          '<div class="progress" style="margin:8px 0"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="test-nav" style="margin-top:6px">' +
            '<button class="btn-pri" type="button" data-continuar="' + this.esc(x.id) + '">Continuar</button>' +
            '<button class="btn-sec" type="button" data-descartar="' + this.esc(x.id) + '">Descartar</button>' +
          '</div></div>';
      }

      const nFallos = (x.fallosClaves || []).length;
      return '<div class="test-item terminado">' +
        '<div class="test-item-cab"><span class="test-badge ok">' + (x.nota != null ? Number(x.nota).toFixed(2) : '—') + '</span>' +
        '<span class="test-item-fecha">' + fecha + '</span></div>' +
        '<div class="test-item-t">' + this.esc(nombre) + '</div>' +
        '<div class="test-item-m">' + x.ok + ' aciertos · ' + x.mal + ' fallos · ' + x.blanco +
          ' en blanco · ' + x.pct + '%</div>' +
        (nFallos
          ? '<div class="test-nav" style="margin-top:6px"><button class="btn-pri" type="button" data-repasar="' +
            this.esc(x.fecha) + '">Repasar falladas (' + nFallos + ')</button></div>'
          : '<div class="test-item-m" style="opacity:.6;margin-top:5px">Sin fallos que repasar</div>') +
        '</div>';
    }).join('');

    el.querySelectorAll('[data-continuar]').forEach((b) =>
      b.addEventListener('click', () => this.continuarPausada(b.dataset.continuar)));
    el.querySelectorAll('[data-descartar]').forEach((b) =>
      b.addEventListener('click', () => this.descartarPausada(b.dataset.descartar)));
    el.querySelectorAll('[data-repasar]').forEach((b) =>
      b.addEventListener('click', () => this.repasarFalladasDe(b.dataset.repasar)));
  },

  repasarFalladasDe(fecha) {
    const h = (this.historial || []).find((r) => r.fecha === fecha);
    if (!h) { this.toast('No encuentro ese test'); return; }
    const claves = h.fallosClaves || [];
    if (!claves.length) { this.toast('Ese test no tiene fallos que repasar'); return; }
    const set = new Set(claves);
    const lista = this.poolGlobal().filter((p) => set.has(this.clave(p)));
    if (!lista.length) { this.toast('Esas preguntas ya no están en el banco'); return; }
    this.iniciarConLista(lista, 'Repaso de falladas');
  },

  /* Crea una sesion a partir de una lista de preguntas ya resuelta. */
  iniciarConLista(lista, titulo) {
    if (!lista || !lista.length) return;
    this.sesion = {
      bancoId: this.banco ? this.banco.id : (lista[0]._banco || ''),
      modo: 'repaso',
      titulo: titulo || 'Repaso',
      examenId: null,
      preguntas: lista.map((p) => ({
        n: p.n,
        _banco: p._banco || (this.banco ? this.banco.id : ''),
        ejercicio: p.ejercicio || 1,
        enunciado: p.enunciado,
        opciones: p.opciones,
        correcta: p.correcta,
        reserva: !!p.reserva,
        fuente: this.fuenteDe(p),
        justificacion: p.justificacion || '',
        base: p.base || ''
      })),
      respuestas: {}, corregidas: {}, contadas: {}, descartadas: {},
      idx: 0, inicio: Date.now(), fin: null, minutos: 0,
      penal: this.ajustes.penal, correccionInmediata: false, tiempo: 0
    };
    this._irRunner = true;
    this.guardarSesion();
    this.arrancarCrono();
    this.pintarPregunta();
    this.mostrarTab('tab-test');
  },

  /* ================= estadísticas ================= */

  pintarStats() {
    try {
      this.pintarStatsGlobal();
      this.pintarGrafico();
      this.pintarStatsLeyes();
      this.pintarMasFalladas();
      this.pintarHistorial();
    } catch (e) {
      console.error('pintarStats', e);
    }
  },

  /* ---------- racha diaria ---------- */

  registrarActividad(n) {
    const hoy = this.hoyISO();
    const act = this.dget('actividad', {}) || {};
    act[hoy] = (act[hoy] || 0) + (n || 1);
    this.dset('actividad', act);
  },

  rachaDias() {
    const act = this.dget('actividad', {}) || {};
    const d = new Date();
    if (!act[this.hoyISO(d)]) d.setDate(d.getDate() - 1);
    let racha = 0;
    for (let i = 0; i < 3650; i++) {
      if (!act[this.hoyISO(d)]) break;
      racha++;
      d.setDate(d.getDate() - 1);
    }
    return racha;
  },

  preguntasHoy() {
    const act = this.dget('actividad', {}) || {};
    return act[this.hoyISO()] || 0;
  },

  /* ---------- acierto por ley ---------- */

  pintarStatsLeyes() {
    const el = document.getElementById('stats-leyes');
    if (!el) return;
    const acc = {};
    this.poolGlobal().forEach((p) => {
      const st = this.porPregunta[this.clave(p)];
      if (!st) return;
      const t = (st.ok || 0) + (st.mal || 0);
      if (!t) return;
      const l = this.leyDe(p);
      if (!l) return;
      const a = acc[l] = acc[l] || { ok: 0, tot: 0 };
      a.ok += st.ok || 0;
      a.tot += t;
    });

    const lista = Object.keys(acc).map((ley) => ({
      ley: ley, ok: acc[ley].ok, tot: acc[ley].tot,
      pct: Math.round(acc[ley].ok / acc[ley].tot * 100)
    })).sort((a, b) => a.pct - b.pct || b.tot - a.tot);

    if (!lista.length) {
      el.innerHTML = '<div class="mem-vacio">Todavía no hay datos por ley. Haz algún test.</div>';
      return;
    }

    el.innerHTML = lista.map((x) =>
      '<div class="ley-item">' +
        '<div class="ley-cab"><span class="ley-nombre">' + this.esc(x.ley) + '</span>' +
        '<span class="ley-pct ' + (x.pct >= 50 ? 'ok' : 'mal') + '">' + x.pct + '%</span></div>' +
        '<div class="ley-barra"><i class="' + (x.pct >= 50 ? '' : 'mal') + '" style="width:' + x.pct + '%"></i></div>' +
        '<div class="ley-meta">' + x.ok + ' aciertos de ' + x.tot + ' respuestas</div>' +
      '</div>').join('');
  },

  /* ---------- buscador de preguntas ---------- */

  buscar(texto) {
    const el = document.getElementById('resultados-busqueda');
    if (!el) return;
    const q = String(texto || '').trim().toLowerCase();
    if (q.length < 2) { el.innerHTML = ''; return; }

    const res = [];
    this.poolGlobal().forEach((p) => {
      const enun = String(p.enunciado || '').toLowerCase();
      const base = String(p.base || '').toLowerCase();
      const ops = ['a', 'b', 'c', 'd'].map((l) => String((p.opciones || {})[l] || '')).join(' ').toLowerCase();
      if (enun.indexOf(q) !== -1 || base.indexOf(q) !== -1 || ops.indexOf(q) !== -1) res.push(p);
    });

    if (!res.length) { el.innerHTML = '<div class="mem-vacio">Sin resultados.</div>'; return; }

    el.innerHTML = res.slice(0, 30).map((p) => {
      const st = this.porPregunta[this.clave(p)] || {};
      return '<div class="res-busqueda">' +
        '<div class="enun">' + this.esc(p.enunciado) + '</div>' +
        '<div class="meta">' + this.esc(this.leyDe(p) || 'Sin base legal') +
          ' · ' + this.esc(this.txtBloqueP(p)) +
          ' · Aciertos ' + (st.ok || 0) + ' / Fallos ' + (st.mal || 0) + '</div>' +
        '<div class="meta" style="margin-top:4px"><b>Correcta:</b> ' +
          String(p.correcta || '').toUpperCase() + ') ' +
          this.esc((p.opciones || {})[p.correcta] || '') + '</div>' +
      '</div>';
    }).join('') +
    (res.length > 30 ? '<div class="mem-vacio">Mostrando 30 de ' + res.length + '. Afina la búsqueda.</div>' : '');
  },

  txtBloqueP(p) {
    return { test: 'Test', caso: 'Caso práctico', informatica: 'Informática' }[this.bloqueDe(p)] || '';
  },

  pintarStatsGlobal() {
    const el = document.getElementById('stats-global');
    if (!el) return;
    const h = this.historial;
    const totalPreg = h.reduce((a, r) => a + (r.total || 0), 0);
    const totalOk = h.reduce((a, r) => a + (r.ok || 0), 0);
    const pct = totalPreg > 0 ? Math.round((totalOk / totalPreg) * 100) : 0;
    const mejor = h.length ? Math.max.apply(null, h.map((r) => r.pct || 0)) : 0;
    const ultimas = h.slice(-5);
    const pctUlt5 = ultimas.length
      ? Math.round(ultimas.reduce((a, r) => a + (r.pct || 0), 0) / ultimas.length) : 0;

    el.innerHTML =
      this.mini(h.length, 'Tests realizados') +
      this.mini(totalPreg, 'Preguntas contestadas') +
      this.mini(pct + '%', 'Acierto global', pct >= 50 ? 'ok' : 'mal') +
      this.mini(mejor + '%', 'Mejor test') +
      this.mini(pctUlt5 + '%', 'Media últimos 5', pctUlt5 >= 50 ? 'ok' : 'mal') +
      this.mini(this.rachaDias(), 'Días seguidos', this.rachaDias() > 0 ? 'ok' : '') +
      this.mini(this.preguntasHoy(), 'Preguntas hoy') +
      this.mini(this.fallosDeBanco().length, 'Fallos pendientes') +
      this.mini(this.muyFalladasDeBanco(), 'Muy falladas', this.muyFalladasDeBanco() ? 'mal' : '');
  },

  pintarGrafico() {
    const el = document.getElementById('stats-grafico');
    if (!el) return;
    const h = this.historial.slice(-20);
    if (!h.length) { el.innerHTML = '<div class="vacio">Todavía no hay tests.</div>'; return; }
    el.innerHTML = h.map((r) => {
      const p = r.pct || 0;
      const cls = p >= 50 ? 'ok' : 'mal';
      return '<div class="barra-wrap" title="' + p + '%">' +
        '<div class="barra ' + cls + '" style="height:' + Math.max(3, p) + '%"></div>' +
        '<div class="barra-txt">' + p + '</div></div>';
    }).join('');
  },

  pintarMasFalladas() {
    const el = document.getElementById('stats-falladas');
    if (!el || !this.banco) return;
    const porPreg = this.poolGlobal()
      .map((p) => {
        const s = this.porPregunta[this.clave(p)];
        if (!s) return null;
        const t = (s.ok || 0) + (s.mal || 0);
        if (!t || !(s.mal > 0)) return null;
        return { p, ok: s.ok || 0, mal: s.mal || 0, t, ratio: (s.mal || 0) / t };
      })
      .filter(Boolean)
      .sort((a, b) => b.ratio - a.ratio || b.mal - a.mal)
      .slice(0, 10);

    if (!porPreg.length) { el.innerHTML = '<div class="vacio">Aún no has fallado ninguna pregunta.</div>'; return; }

    el.innerHTML = porPreg.map((x) =>
      '<div class="fallo"><div class="fallo-num">Pregunta ' + x.p.n + ' · ' +
      x.mal + ' fallo(s) de ' + x.t + ' intento(s)</div>' +
      '<div class="fallo-enun">' + this.esc(x.p.enunciado) + '</div>' +
      '<div class="fallo-ok">Correcta: ' + x.p.correcta.toUpperCase() + '</div></div>'
    ).join('');
  },

  pintarHistorial() {
    const el = document.getElementById('stats-historial');
    if (!el) return;
    const h = this.historial.slice(-30).reverse();
    if (!h.length) { el.innerHTML = '<div class="vacio">Sin historial.</div>'; return; }
    const nombres = { simulacro: 'Simulacro', test: 'Test', rango: 'Rango', fallos: 'Fallos', 'fallos-sesion': 'Fallos de la sesión', config: 'Personalizado', oficial: 'Examen oficial' };
    el.innerHTML = h.map((r) =>
      '<div class="hist-item"><span>' + this.fechaCorta(r.fecha) + ' · ' +
      (nombres[r.modo] || r.modo || 'Test') + ' · ' + r.ok + '/' + r.total + '</span>' +
      '<span class="hist-pct ' + ((r.pct || 0) >= 50 ? 'ok' : 'mal') + '">' + (r.pct || 0) + '%</span></div>'
    ).join('');
  },

  /* ================= importar PDF ================= */

  abrirImportPDF() {
    document.getElementById('modal-ajustes').classList.add('hidden');
    document.getElementById('file-pdf').click();
  },

  /* Extrae el texto de un PDF. Devuelve tambien cuantas paginas y fragmentos
     ha visto, para poder diagnosticar sin adivinar. */
  async leerPDF(file, extra) {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js no está cargado');
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(Object.assign({
      data: buf,
      // Sin estos dos, pdf.js no decodifica las fuentes no estandar y el
      // texto sale vacio en silencio: la app lo daba por "escaneado".
      cMapUrl: 'vendor/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'vendor/standard_fonts/'
    }, extra || {})).promise;

    let texto = '';
    let items = 0;
    let conTexto = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      let cont;
      try {
        cont = await page.getTextContent();
      } catch (e) {
        cont = { items: [] };
      }
      let ultimaY = null;
      (cont.items || []).forEach((it) => {
        items++;
        const str = (it && it.str) ? it.str : '';
        if (str.trim()) conTexto++;
        const y = (it && it.transform) ? it.transform[5] : null;
        if (ultimaY !== null && y !== null && Math.abs(y - ultimaY) > 4) texto += '\n';
        texto += str;
        if (it && it.hasEOL) texto += '\n';
        if (y !== null) ultimaY = y;
      });
      texto += '\n';
    }
    return { texto: texto, paginas: pdf.numPages, items: items, conTexto: conTexto };
  },

  /* Parser heuristico: busca "1." / "1)" / "Pregunta 1", opciones a) b) c) d)
     y una marca de respuesta correcta. Si no la encuentra, se elige a mano. */
  parsearPreguntas(texto) {
    const t = String(texto || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
    // "1." "1)" "1.-" "1 -" "Pregunta 1". El OCR a veces antepone basura
    // corta ("El 1.-", "le 3.-"), asi que se toleran hasta 3 letras delante.
    const rePreg = /(?:^|\n)[ \t]*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{0,3}[.,]?[ \t]*(\d{1,3})\s*[\.\)\-–—]+\s+/g;
    const marcas = [];
    let m;
    while ((m = rePreg.exec(t)) !== null) {
      marcas.push({ num: m[1], ini: rePreg.lastIndex, pos: m.index });
    }
    if (!marcas.length) return [];

    const out = [];
    marcas.forEach((mk, k) => {
      const fin = (k + 1 < marcas.length) ? marcas[k + 1].pos : t.length;
      let bloque = t.slice(mk.ini, fin).trim();
      if (!bloque) return;

      // Respuesta correcta explicita. Primero "Respuesta/Solucion"; si no hay,
      // una marca "correcta: X". Sin la bandera i, "Respuesta" no casaba.
      let correcta = '';
      let mr = bloque.match(/(?:respuesta|soluci[oó]n)\s*(?:correcta)?\s*[:\-–—]?\s*([a-dA-D])\b/i);
      if (!mr) mr = bloque.match(/\bcorrecta\s*[:\-–—]\s*([a-dA-D])\b/i);
      if (mr) {
        correcta = mr[1].toLowerCase();
        bloque = bloque.slice(0, mr.index).trim();
      }

      // Opciones
      const reOp = /(?:^|\n)\s*([a-dA-D])[a-dA-D]?\s*[\)\.\-–—]+\s*/g;
      const pos = [];
      let mo;
      while ((mo = reOp.exec('\n' + bloque)) !== null) {
        pos.push({ letra: mo[1].toLowerCase(), ini: mo.index, fin: reOp.lastIndex });
      }
      if (pos.length < 2) return;

      const enunciado = ('\n' + bloque).slice(0, pos[0].ini).trim();
      if (enunciado.length < 10) return;

      const opciones = { a: '', b: '', c: '', d: '' };
      pos.forEach((p, i) => {
        const finOp = (i + 1 < pos.length) ? pos[i + 1].ini : ('\n' + bloque).length;
        const val = ('\n' + bloque).slice(p.fin, finOp).trim();
        if (['a', 'b', 'c', 'd'].includes(p.letra)) opciones[p.letra] = val;
      });

      const rellenas = ['a', 'b', 'c', 'd'].filter((l) => opciones[l]);
      if (rellenas.length < 2) return;

      out.push({
        n: out.length + 1,
        enunciado,
        opciones,
        correcta: (correcta && opciones[correcta]) ? correcta : '',
        fuente: 'preparador'
      });
    });
    return out;
  },

  async importarPDF(event) {
    const f = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!f) return;
    this._pdfTitulo = f.name.replace(/\.pdf$/i, '');
    this._pdfFile = f;
    this.toast('Leyendo el PDF…');
    try {
      let r = await this.leerPDF(f);

      if (!r.texto.trim()) {
        this.toast('Reintentando con otras fuentes…');
        const alternativas = [
          { disableFontFace: true, useSystemFonts: true },
          { disableFontFace: true, isEvalSupported: false, useSystemFonts: true }
        ];
        for (let k = 0; k < alternativas.length && !r.texto.trim(); k++) {
          try { r = await this.leerPDF(f, alternativas[k]); }
          catch (e2) { console.warn('reintento PDF', e2); }
        }
      }

      if (!r.texto.trim()) {
        this.mostrarImportTexto(r, false);
        return;
      }

      const preguntas = this.parsearPreguntas(r.texto);
      if (!preguntas.length) {
        this.mostrarImportTexto(r, true);
        return;
      }

      this._pdfPreguntas = preguntas;
      this.mostrarRevisionPDF();
    } catch (e) {
      console.error('importarPDF', e);
      this.toast('No se pudo leer el PDF: ' + (e.message || e));
    }
  },

  /* El PDF no se deja leer: se ofrece pegar el texto. Nunca dejamos al
     usuario con un "parece un escaneo" cuando puede que no lo sea. */
  mostrarImportTexto(diag, habiaTexto) {
    const msg = document.getElementById('texto-pdf-msg');
    if (msg) {
      msg.innerHTML = habiaTexto
        ? 'El PDF sí tiene texto (' + diag.conTexto + ' fragmentos en ' + diag.paginas +
          ' páginas), pero no he reconocido el formato de las preguntas. Pega el texto y lo intento otra vez.'
        : 'No he podido extraer texto de ese PDF (' + diag.paginas + ' páginas, ' +
          diag.items + ' fragmentos, ' + diag.conTexto + ' con texto). Puede que la capa de texto ' +
          'no sea legible para el lector. Pega el texto a mano y seguimos.';
    }
    const a = document.getElementById('texto-pdf-area');
    if (a) a.value = '';
    document.getElementById('modal-texto-pdf').classList.remove('hidden');
    setTimeout(() => { if (a) a.focus(); }, 120);
  },

  procesarTextoPegado() {
    const a = document.getElementById('texto-pdf-area');
    const t = ((a && a.value) || '').trim();
    if (!t) { this.toast('Pega primero el texto del examen'); return; }
    const preguntas = this.parsearPreguntas(t);
    if (!preguntas.length) {
      this.toast('No he reconocido preguntas en ese texto');
      return;
    }
    document.getElementById('modal-texto-pdf').classList.add('hidden');
    this._pdfPreguntas = preguntas;
    this.mostrarRevisionPDF();
  },

  cerrarImportTexto() {
    document.getElementById('modal-texto-pdf').classList.add('hidden');
    const btn = document.getElementById('btn-ocr-pdf');
    if (btn) { btn.disabled = false; btn.textContent = 'Leerlo con OCR (recomendado)'; }
    const prog = document.getElementById('ocr-progreso');
    if (prog) prog.classList.add('hidden');
  },

  /* OCR en el navegador con tesseract.js. Para PDFs con el texto convertido
     a curvas (los de Daniel Dorta): se ve perfecto pero no hay nada que leer. */
  async ocrPDF(file, onProgress) {
    if (typeof Tesseract === 'undefined') throw new Error('OCR no disponible');
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({
      data: buf,
      cMapUrl: 'vendor/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'vendor/standard_fonts/'
    }).promise;
    const total = pdf.numPages;
    this._ocrPag = 1;
    this._ocrTotal = total;

    // El worker resuelve las rutas relativas contra su propia URL, asi que
    // hay que pasarle URLs absolutas o buscaria vendor/tesseract/vendor/...
    const base = new URL('vendor/tesseract/', location.href).href;
    const worker = await Tesseract.createWorker('spa', 1, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'tesseract-core-simd-lstm.wasm.js',
      langPath: base + 'lang',
      logger: (m) => {
        if (m && m.status === 'recognizing text' && onProgress) {
          const pct = ((this._ocrPag - 1) + (m.progress || 0)) / total;
          onProgress(pct, this._ocrPag, total);
        }
      }
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let texto = '';

    try {
      for (let i = 1; i <= total; i++) {
        this._ocrPag = i;
        if (onProgress) onProgress((i - 1) / total, i, total);
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 2.2 });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const res = await worker.recognize(canvas);
        texto += ((res && res.data && res.data.text) || '') + '\n\n';
        if (onProgress) onProgress(i / total, i, total);
      }
    } finally {
      try { await worker.terminate(); } catch (e) {}
    }
    return { texto: texto, paginas: total };
  },

  async lanzarOCR() {
    const f = this._pdfFile;
    if (!f) { this.toast('Vuelve a elegir el PDF'); return; }
    const btn = document.getElementById('btn-ocr-pdf');
    const prog = document.getElementById('ocr-progreso');
    const fill = document.getElementById('ocr-barra-fill');
    const txt = document.getElementById('ocr-txt');

    if (btn) { btn.disabled = true; btn.textContent = 'Leyendo con OCR…'; }
    if (prog) prog.classList.remove('hidden');
    if (fill) fill.style.width = '0%';
    if (txt) txt.textContent = 'Preparando el OCR… la primera vez tarda un poco.';

    try {
      const r = await this.ocrPDF(f, (pct, pag, total) => {
        if (fill) fill.style.width = Math.round(pct * 100) + '%';
        if (txt) txt.textContent = 'Página ' + pag + ' de ' + total + ' · ' + Math.round(pct * 100) + '%';
      });

      const preguntas = this.parsearPreguntas(r.texto);
      if (!preguntas.length) {
        if (txt) txt.textContent = 'OCR terminado, pero no he reconocido preguntas. Prueba a pegar el texto a mano.';
        if (btn) { btn.disabled = false; btn.textContent = 'Reintentar OCR'; }
        return;
      }
      this._pdfPreguntas = preguntas;
      this._pdfTexto = r.texto;
      document.getElementById('modal-texto-pdf').classList.add('hidden');
      this.mostrarRevisionPDF();
    } catch (e) {
      console.error('OCR', e);
      if (txt) txt.textContent = 'El OCR ha fallado: ' + (e.message || e);
      if (btn) { btn.disabled = false; btn.textContent = 'Reintentar OCR'; }
    }
  },

  mostrarRevisionPDF() {
    const preguntas = this._pdfPreguntas || [];
    const modal = document.getElementById('modal-pdf');
    document.getElementById('pdf-titulo').value = this._pdfTitulo || '';
    const conResp = preguntas.filter((p) => p.correcta).length;
    document.getElementById('pdf-resumen').innerHTML =
      'Detectadas <strong>' + preguntas.length + '</strong> preguntas · ' +
      '<strong>' + conResp + '</strong> con respuesta correcta reconocida.' +
      (conResp < preguntas.length
        ? '<br><span style="color:#b45309">Marca la correcta en las que falten o no se guardarán.</span>'
        : '');

    const el = document.getElementById('pdf-lista');
    el.innerHTML = preguntas.map((p, i) => {
      const ops = ['a', 'b', 'c', 'd'].filter((l) => p.opciones[l]).map((l) =>
        '<div>' + l.toUpperCase() + ') ' +
        (p.correcta === l ? '<b class="ok">' + this.esc(p.opciones[l]) + '</b>' : this.esc(p.opciones[l])) +
        '</div>').join('');
      const sel = '<select class="pdf-item-sel" data-pdf-resp="' + i + '">' +
        '<option value="">— correcta —</option>' +
        ['a', 'b', 'c', 'd'].filter((l) => p.opciones[l]).map((l) =>
          '<option value="' + l + '"' + (p.correcta === l ? ' selected' : '') + '>' + l.toUpperCase() + '</option>').join('') +
        '</select>';
      return '<div class="pdf-item' + (p.incluir === false ? ' off' : '') + '">' +
        '<div class="pdf-item-cab">' +
          '<label style="display:flex;align-items:center;gap:6px">' +
            '<input type="checkbox" data-pdf-inc="' + i + '"' + (p.incluir === false ? '' : ' checked') + '> Pregunta ' + (i + 1) +
          '</label>' + sel +
        '</div>' +
        '<div class="pdf-item-enun">' + this.esc(p.enunciado) + '</div>' +
        '<div class="pdf-item-ops">' + ops + '</div>' +
      '</div>';
    }).join('');

    el.querySelectorAll('[data-pdf-inc]').forEach((c) => {
      c.addEventListener('change', () => {
        const i = parseInt(c.dataset.pdfInc, 10);
        this._pdfPreguntas[i].incluir = c.checked;
        c.closest('.pdf-item').classList.toggle('off', !c.checked);
        this.actualizarBotonPDF();
      });
    });
    el.querySelectorAll('[data-pdf-resp]').forEach((s) => {
      s.addEventListener('change', () => {
        const i = parseInt(s.dataset.pdfResp, 10);
        this._pdfPreguntas[i].correcta = s.value;
        this.mostrarRevisionPDF();
      });
    });

    modal.classList.remove('hidden');
    this.actualizarBotonPDF();
  },

  actualizarBotonPDF() {
    const lista = (this._pdfPreguntas || []).filter((p) => p.incluir !== false && p.correcta);
    const btn = document.getElementById('btn-guardar-pdf');
    btn.disabled = lista.length === 0;
    btn.textContent = 'Guardar ' + lista.length + ' preguntas';
  },

  guardarBancoPDF() {
    const titulo = (document.getElementById('pdf-titulo').value || '').trim() || 'Examen importado';
    const fuente = (document.getElementById('pdf-fuente').value === 'oficial') ? 'oficial' : 'preparador';
    const bloque = document.getElementById('pdf-bloque').value || 'test';
    const lista = (this._pdfPreguntas || []).filter((p) => p.incluir !== false && p.correcta);
    if (!lista.length) { this.toast('No hay preguntas con respuesta marcada'); return; }
    const banco = {
      id: 'pdf-' + Date.now(),
      titulo,
      convocatoria: fuente === 'oficial' ? 'Examen oficial' : 'Material del preparador',
      examen: 'Importado desde PDF',
      fecha: new Date().toISOString().slice(0, 10),
      fuente,
      bloque,
      preguntas: lista.map((p, i) => ({
        n: i + 1,
        enunciado: p.enunciado,
        opciones: p.opciones,
        correcta: p.correcta,
        fuente,
        bloque,
        justificacion: '',
        base: ''
      }))
    };
    const imp = this.dget('bancos', []) || [];
    const idx = imp.findIndex((b) => b.id === banco.id);
    if (idx >= 0) imp[idx] = banco; else imp.push(banco);
    this.dset('bancos', imp);

    const base = Array.isArray(window.BANCOS) ? window.BANCOS : [];
    const vistos = new Set();
    this.bancos = base.concat(imp).filter((b) => {
      if (!b || !b.id || !Array.isArray(b.preguntas)) return false;
      if (vistos.has(b.id)) return false;
      vistos.add(b.id); return true;
    });
    this.banco = this.banco || banco;

    document.getElementById('modal-pdf').classList.add('hidden');
    this._pdfPreguntas = null;
    this.pintarInicio();
    this.pintarStats();
    this.pintarChipsFuente();
    this.toast('Añadido "' + titulo + '": ' + lista.length + ' preguntas');
  },

  cerrarModalPDF() {
    document.getElementById('modal-pdf').classList.add('hidden');
    this._pdfPreguntas = null;
  },

  /* ================= MemorIA (repaso diario) =================
     Entra sola al tercer fallo o a mano con el boton ★.
     Solo sale cuando se acierta 5 dias seguidos. */

  hoyISO(d) {
    const x = d ? new Date(d) : new Date();
    const p = (n) => (n < 10 ? '0' : '') + n;
    return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate());
  },

  ayerISO() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return this.hoyISO(d);
  },

  cargarMemoria() {
    if (!this.mem) this.mem = this.dget('memoria', {}) || {};
    return this.mem;
  },

  guardarMemoria() { this.dset('memoria', this.mem || {}); },

  enMemoria(clave) { return !!(this.cargarMemoria()[clave]); },

  memorizar(p, origen) {
    const k = this.clave(p);
    const mem = this.cargarMemoria();
    if (mem[k]) return false;
    mem[k] = {
      clave: k,
      banco: p._banco || (this.banco ? this.banco.id : ''),
      n: p.n,
      enunciado: p.enunciado,
      opciones: p.opciones,
      correcta: p.correcta,
      fuente: p.fuente || 'oficial',
      justificacion: p.justificacion || '',
      base: p.base || '',
      alta: new Date().toISOString(),
      origen: origen || 'manual',
      racha: 0,
      ultimoDia: '',
      fallos: 1,
      dominada: false
    };
    this.guardarMemoria();
    this.pintarMemoria();
    return true;
  },

  quitarMemoria(clave) {
    const mem = this.cargarMemoria();
    if (!mem[clave]) return;
    delete mem[clave];
    this.guardarMemoria();
    this.pintarMemoria();
  },

  /* Una pregunta esta pendiente si no esta dominada y no se ha repasado hoy. */
  pendienteHoy(m) {
    if (!m || m.dominada) return false;
    return m.ultimoDia !== this.hoyISO();
  },

  pendientesHoy() {
    const mem = this.cargarMemoria();
    return Object.keys(mem).map((k) => mem[k]).filter((m) => this.pendienteHoy(m));
  },

  registrarRepaso(clave, acierto) {
    const mem = this.cargarMemoria();
    const m = mem[clave];
    if (!m || m.dominada) return;
    const hoy = this.hoyISO();
    if (m.ultimoDia === hoy) return; // ya contabilizada hoy

    if (acierto) {
      m.racha = (m.ultimoDia === this.ayerISO()) ? ((m.racha || 0) + 1) : 1;
      m.ultimoDia = hoy;
      m.ultimoAcierto = hoy;
      if (m.racha >= 5) {
        m.dominada = true;
        m.fechaDominada = hoy;
      }
    } else {
      m.racha = 0;
      m.ultimoDia = hoy;
      m.fallos = (m.fallos || 0) + 1;
    }
    this.guardarMemoria();
  },

  memoriaActual() {
    const s = this.sesion;
    if (!s) return null;
    const p = s.preguntas[s.idx];
    if (!p) return null;
    return this.cargarMemoria()[this.clave(p)] || null;
  },

  memorizarActual() {
    const s = this.sesion;
    if (!s) return;
    const p = s.preguntas[s.idx];
    if (!p) return;
    const k = this.clave(p);
    if (this.enMemoria(k)) {
      this.quitarMemoria(k);
      this.toast('Quitada de MemorIA');
    } else {
      this.memorizar(p, 'manual');
      this.toast('Añadida a MemorIA');
    }
    this.pintarBotonMemorizar();
  },

  pintarBotonMemorizar() {
    const btn = document.getElementById('btn-memorizar');
    if (!btn) return;
    const m = this.memoriaActual();
    if (m) {
      btn.classList.add('activa');
      btn.textContent = m.dominada ? '★ Dominada' : '★ MemorIA ' + (m.racha || 0) + '/5';
    } else {
      btn.classList.remove('activa');
      btn.textContent = '★ MemorIA';
    }
  },

  setMemFiltro(f) {
    this._memFiltro = f || 'hoy';
    this.$$('#memoria-filtros [data-mem]').forEach((b) => b.classList.toggle('on', b.dataset.mem === this._memFiltro));
    this.pintarMemoria();
  },

  pintarMemoria() {
    const mem = this.cargarMemoria();
    const todas = Object.keys(mem).map((k) => mem[k]);
    const pend = todas.filter((m) => this.pendienteHoy(m));
    const dominadas = todas.filter((m) => m.dominada);
    const enRacha = todas.filter((m) => !m.dominada && (m.racha || 0) > 0);

    const cont = document.getElementById('memoria-contadores');
    if (cont) {
      cont.innerHTML =
        this.mini(pend.length, 'Para hoy', pend.length ? 'mal' : '') +
        this.mini(enRacha.length, 'En racha') +
        this.mini(dominadas.length, 'Dominadas', dominadas.length ? 'ok' : '') +
        this.mini(todas.length, 'En total');
    }

    const btn = document.getElementById('btn-memoria-repasar');
    if (btn) {
      btn.disabled = pend.length === 0;
      btn.textContent = pend.length
        ? 'Repasar ahora (' + pend.length + ')'
        : 'No hay nada para hoy';
    }

    const el = document.getElementById('memoria-lista');
    if (!el) return;
    const f = this._memFiltro || 'hoy';
    let lista = todas;
    if (f === 'hoy') lista = pend;
    else if (f === 'dominadas') lista = dominadas;
    lista = lista.slice().sort((a, b) => (b.alta || '').localeCompare(a.alta || ''));

    if (!lista.length) {
      el.innerHTML = '<div class="mem-vacio">' +
        (f === 'hoy' ? 'Nada que repasar hoy. Vuelve mañana.' :
         f === 'dominadas' ? 'Todavía no has dominado ninguna.' :
         'MemorIA está vacía. Las preguntas entran al tercer fallo.') +
        '</div>';
      return;
    }

    el.innerHTML = lista.map((m) => {
      const racha = (m.racha || 0);
      const dias = [0, 1, 2, 3, 4].map((i) =>
        '<i class="mem-dia' + (i < racha ? ' on' : '') + '"></i>').join('');
      const badge = m.dominada
        ? '<span class="mem-badge dom">Dominada</span>'
        : '<span class="mem-badge ' + (m.origen === 'auto' ? 'auto' : 'manual') + '">' +
          (m.origen === 'auto' ? '3 fallos' : 'Manual') + '</span>';
      const estado = m.dominada
        ? 'Fuera de MemorIA desde el ' + (m.fechaDominada || '—')
        : (this.pendienteHoy(m) ? 'Toca repasar hoy' : 'Repasada hoy');
      return '<div class="mem-item">' +
        '<div class="mem-item-cab">' +
          badge + '<span>' + this.esc(estado) + '</span>' +
          '<span class="mem-racha">' + dias + '<b class="mem-racha-tx">' + racha + '/5</b></span>' +
        '</div>' +
        '<div class="mem-item-enun">' + this.esc(m.enunciado) + '</div>' +
        '<div class="card-meta">Pregunta ' + m.n + ' · ' + this.esc(m.base || 'Sin base legal') +
          ' · fallos acumulados: ' + (m.fallos || 0) + '</div>' +
      '</div>';
    }).join('');
  },

  empezarFalladasInicio() {
    const base = this.fallosDeBanco();
    if (!base.length) { this.toast('No tienes fallos pendientes'); return; }
    const inp = document.getElementById('inicio-n-falladas');
    const pedidas = Math.max(1, parseInt(inp ? inp.value : 25, 10) || 25);
    const n = Math.min(pedidas, base.length);
    const lista = (this.ajustes.barajar ? this.barajar(base) : base.slice()).slice(0, n);
    this.iniciarConLista(lista, 'Repaso de falladas');
  },

  empezarMemoria() {
    const pend = this.pendientesHoy();
    if (!pend.length) { this.toast('No hay preguntas para repasar hoy'); return; }
    const lista = pend.map((m) => ({
      n: m.n,
      _banco: m.banco,
      ejercicio: 1,
      enunciado: m.enunciado,
      opciones: m.opciones,
      correcta: m.correcta,
      reserva: false,
      fuente: m.fuente || 'oficial',
      justificacion: m.justificacion || '',
      base: m.base || ''
    }));

    this.sesion = {
      bancoId: this.banco ? this.banco.id : (lista[0]._banco || ''),
      modo: 'memoria',
      titulo: 'MemorIA · repaso del ' + this.hoyISO(),
      examenId: null,
      preguntas: lista,
      respuestas: {},
      corregidas: {},
      contadas: {},
      descartadas: {},
      idx: 0,
      inicio: Date.now(),
      fin: null,
      minutos: 0,
      penal: 0,
      correccionInmediata: true,   // en MemorIA siempre corrige al momento
      tiempo: 0
    };
    this._irRunner = true;
    this.guardarSesion();
    this.arrancarCrono();
    this.pintarPregunta();
    this.mostrarTab('tab-test');
    this.pintarSegModo();
  },

  /* ================= avisos de versión e instalación ================= */

  vigilarActualizaciones() {
    if (!('serviceWorker' in navigator)) return;
    const mostrar = () => {
      const b = document.getElementById('banner-update');
      if (b) b.classList.remove('hidden');
    };
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;
      if (reg.waiting) mostrar();
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) mostrar();
        });
      });
    }).catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      navigator.serviceWorker.getRegistration()
        .then((r) => r && r.update().catch(() => {}))
        .catch(() => {});
    });
  },

  prepararInstalacion() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this._installEvt = e;
      let oculto = false;
      try { oculto = !!localStorage.getItem('testjusticia:install-oculto'); } catch (err) {}
      const b = document.getElementById('banner-install');
      if (b && !oculto) b.classList.remove('hidden');
    });
  },

  instalar() {
    const e = this._installEvt;
    const b = document.getElementById('banner-install');
    if (!e) {
      this.toast('Usa el menú del navegador → «Añadir a pantalla de inicio»');
      return;
    }
    e.prompt();
    if (e.userChoice) {
      e.userChoice.then(() => {
        this._installEvt = null;
        if (b) b.classList.add('hidden');
      }).catch(() => {});
    }
  },

  cerrarBannerInstall() {
    const b = document.getElementById('banner-install');
    if (b) b.classList.add('hidden');
    try { localStorage.setItem('testjusticia:install-oculto', '1'); } catch (e) {}
  },

  /* ================= atajos de teclado =================
     Flecha derecha: siguiente · Flecha izquierda: anterior
     1/2/3/4: opciones A/B/C/D · B: dejar en blanco */

  atajosTeclado(e) {
    if (!this.sesion || this._vistaTest !== 'runner') return;
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'ArrowRight') { e.preventDefault(); this.siguiente(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); this.anterior(); return; }
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); this.blanco(); return; }

    const n = parseInt(e.key, 10);
    if (!isNaN(n) && n >= 1 && n <= 4) {
      e.preventDefault();
      this.responder(['a', 'b', 'c', 'd'][n - 1]);
    }
  },

  _irAPrimeraBlanca() {
    const s = this.sesion;
    if (!s) return;
    const i = s.preguntas.findIndex((p, idx) =>
      s.respuestas[idx] === undefined || s.respuestas[idx] === '');
    if (i >= 0) this.irA(i);
  },

  exportar() {
    const datos = {
      app: 'TestJusticia',
      version: 1,
      exportado: new Date().toISOString(),
      ajustes: this.ajustes,
      historial: this.historial,
      porPregunta: this.porPregunta,
      fallos: this.fallos,
      memoria: this.dget('memoria', {}) || {},
      bancos: this.dget('bancos', []) || []
    };
    const txt = JSON.stringify(datos, null, 2);
    try {
      const blob = new Blob([txt], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'testjusticia-progreso-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      this.toast('Progreso exportado');
    } catch (e) {
      console.error(e);
      this.toast('No se pudo exportar el fichero');
    }
  },

  importar(event) {
    const f = event.target.files && event.target.files[0];
    if (!f) return;
    const lector = new FileReader();
    lector.onload = () => {
      try {
        const d = JSON.parse(lector.result);

        if (Array.isArray(d)) {
          // importación de un BANCO de preguntas
          const imp = this.dget('bancos', []) || [];
          d.forEach((b) => {
            if (b && b.id && Array.isArray(b.preguntas)) {
              const i = imp.findIndex((x) => x.id === b.id);
              if (i >= 0) imp[i] = b; else imp.push(b);
            }
          });
          this.dset('bancos', imp);
          const base = Array.isArray(window.BANCOS) ? window.BANCOS : [];
          const vistos = new Set();
          this.bancos = base.concat(imp).filter((b) => {
            if (!b || !b.id || vistos.has(b.id)) return false;
            vistos.add(b.id); return true;
          });
          this.banco = this.bancos[this.bancos.length - 1] || this.banco;
          this.pintarInicio();
          this.pintarStats();
          this.toast('Banco importado: ' + (this.banco ? this.banco.titulo : ''));
          return;
        }

        if (d.historial) this.historial = d.historial;
        if (d.porPregunta) this.porPregunta = d.porPregunta;
        if (d.fallos) this.fallos = d.fallos;
        if (d.memoria) { this.dset('memoria', d.memoria); this.mem = d.memoria; }
        if (d.ajustes) this.ajustes = Object.assign({}, AJUSTES_DEF, d.ajustes);
        if (Array.isArray(d.bancos)) this.dset('bancos', d.bancos);

        this.dset('historial', this.historial);
        this.dset('porPregunta', this.porPregunta);
        this.dset('fallos', this.fallos);
        this.dset('ajustes', this.ajustes);

        this.leerAjustesUI();
        this.pintarInicio();
        this.pintarStats();
        this.toast('Progreso importado');
      } catch (e) {
        console.error(e);
        this.toast('Fichero no válido');
      }
      event.target.value = '';
    };
    lector.readAsText(f);
  },

  reset() {
    this.confirmar(
      '¿Borrar TODO el progreso de esta cuenta (tests, estadísticas y fallos)? Esta acción no se puede deshacer.',
      'Borrar progreso',
      () => this._reset(),
      null, 'Borrar todo', 'Cancelar'
    );
  },

  _reset() {
    const bancosImp = this.dget('bancos', []) || [];
    this.dborrarTodo();
    if (bancosImp.length) this.dset('bancos', bancosImp);
    this.historial = [];
    this.porPregunta = {};
    this.fallos = [];
    this.examenesHechos = {};
    this.sesion = null;
    this.mem = {};
    this.ddel('memoria');
    this.cfg = { n: 25, min: 0, conjunto: 'todas' };
    clearInterval(this._timer);
    this.pintarInicio();
    this.pintarStats();
    this.vistaTest('portada');
    this.toast('Progreso borrado');
  }
};

/* Expuesto para depuracion y pruebas automatizadas. */
window.App = App;

document.addEventListener('DOMContentLoaded', () => {
  try { App.init(); } catch (e) { console.error('init', e); }
});
