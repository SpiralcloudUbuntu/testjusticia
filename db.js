/* db.js — capa de almacenamiento local (localStorage namespaced).
   Los datos del progreso viven aquí y NO se pierden al actualizar la app. */
const DB = {
  PREFIX: 'testjusticia:',

  get(clave, porDefecto) {
    try {
      const raw = localStorage.getItem(this.PREFIX + clave);
      if (raw === null || raw === undefined) return porDefecto;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('DB.get fallo en', clave, e);
      return porDefecto;
    }
  },

  set(clave, valor) {
    try {
      localStorage.setItem(this.PREFIX + clave, JSON.stringify(valor));
      return true;
    } catch (e) {
      console.error('DB.set fallo en', clave, e);
      return false;
    }
  },

  del(clave) {
    try { localStorage.removeItem(this.PREFIX + clave); } catch (e) { /* noop */ }
  },

  borrarTodo() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(this.PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch (e) { console.error(e); }
  }
};
