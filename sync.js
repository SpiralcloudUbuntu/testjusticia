/* Sincronización entre dispositivos con Firestore (API REST).
   No usa el SDK: son cuatro llamadas fetch y así no pesa nada.

   Estructura en Firestore:
     tj_{codigo}/{cuenta}                    -> { d: JSON con ediciones + progreso }
     tj_{codigo}/{cuenta}/bancos/{idBanco}   -> { d: JSON del examen }

   El código de sincronización lo elige el usuario. Quien no lo sepa, no
   encuentra la colección. */
window.SyncTJ = {
  PROJ: 'bookshelf-app-68ab2',
  KEY: 'AIzaSyDQ93_92eYWzuhlMWiEWzeYOlzgLHyAXZA',
  activo: false,
  codigo: '',
  cuenta: 'senor',
  _ultimoPull: 0,
  _enviando: false,
  _pendiente: false,

  /* ---------- utilidades REST ---------- */

  base() {
    return 'https://firestore.googleapis.com/v1/projects/' + this.PROJ +
      '/databases/(default)/documents/tj_' + encodeURIComponent(this.codigo) +
      '/' + encodeURIComponent(this.cuenta);
  },

  url(sufijo) {
    return this.base() + (sufijo || '') + '?key=' + this.KEY;
  },

  async _fetch(url, opciones) {
    const r = await fetch(url, opciones);
    if (r.status === 404) return null;
    if (!r.ok) {
      let txt = '';
      try { txt = await r.text(); } catch (e) {}
      const err = new Error('Firestore ' + r.status + ': ' + txt.slice(0, 160));
      err.status = r.status;
      throw err;
    }
    return r.json();
  },

  _aJSON(doc) {
    if (!doc || !doc.fields || !doc.fields.d) return null;
    try { return JSON.parse(doc.fields.d.stringValue); } catch (e) { return null; }
  },

  async leerDoc(sufijo) {
    const doc = await this._fetch(this.url(sufijo));
    return this._aJSON(doc);
  },

  async escribirDoc(sufijo, obj) {
    const r = await fetch(this.url(sufijo), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { d: { stringValue: JSON.stringify(obj) } } })
    });
    if (!r.ok) {
      let txt = '';
      try { txt = await r.text(); } catch (e) {}
      const err = new Error('Firestore ' + r.status + ': ' + txt.slice(0, 160));
      err.status = r.status;
      throw err;
    }
    return true;
  },

  async borrarDoc(sufijo) {
    const r = await fetch(this.url(sufijo), { method: 'DELETE' });
    return r.ok || r.status === 404;
  },

  async listarBancos() {
    const doc = await this._fetch(this.url('/bancos') + '&pageSize=300');
    if (!doc || !doc.documents) return [];
    return doc.documents.map((d) => {
      const id = String(d.name || '').split('/').pop();
      return { id: id, banco: this._aJSON(d) };
    }).filter((x) => x.banco);
  },

  /* ---------- lectura y escritura completas ---------- */

  async pull() {
    const raiz = (await this.leerDoc('')) || {};
    const bancos = await this.listarBancos();
    this._ultimoPull = Date.now();
    return {
      ediciones: raiz.ediciones || {},
      progreso: raiz.progreso || {},
      bancos: bancos.map((x) => x.banco),
      actualizado: raiz.actualizado || 0
    };
  },

  async pushEstado(ediciones, progreso) {
    await this.escribirDoc('', {
      ediciones: ediciones || {},
      progreso: progreso || {},
      actualizado: Date.now()
    });
  },

  async pushBancos(bancos, idsRemotos) {
    const locales = {};
    (bancos || []).forEach((b) => { if (b && b.id) locales[b.id] = b; });

    for (const id of Object.keys(locales)) {
      await this.escribirDoc('/bancos/' + encodeURIComponent(id), locales[id]);
    }
    // Quitar en remoto los que ya no existen en local
    for (const id of (idsRemotos || [])) {
      if (!locales[id]) await this.borrarDoc('/bancos/' + encodeURIComponent(id));
    }
  },

  /* ---------- configuración ---------- */

  cargar() {
    try {
      this.codigo = localStorage.getItem('tj_sync_codigo') || '';
      this.activo = localStorage.getItem('tj_sync_activo') === '1' && !!this.codigo;
    } catch (e) {
      this.activo = false;
    }
    return this.activo;
  },

  guardar(codigo, activo) {
    try {
      if (codigo != null) localStorage.setItem('tj_sync_codigo', codigo);
      localStorage.setItem('tj_sync_activo', activo ? '1' : '0');
    } catch (e) {}
    this.codigo = codigo != null ? codigo : this.codigo;
    this.activo = !!activo && !!this.codigo;
  }
};
