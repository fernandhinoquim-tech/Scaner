// Estado compartido del panel.
export const api = window.lanz;

export const P = {
  state: null,
  get config() {
    return P.state.config;
  },
  get env() {
    return P.state.env;
  },
  rerender: () => {},
  navigate: () => {},
};

export function patch(p) {
  return api.patch(p);
}

export function ap() {
  return P.config.appearance;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// Busca un elemento en todos los espacios (incluidos los grupos).
export function findAnywhere(id) {
  for (const ws of P.config.workspaces) {
    for (const it of ws.items) {
      if (it.id === id) return { ws, item: it, parent: null };
      if (it.type === 'group') for (const k of it.items || []) if (k.id === id) return { ws, item: k, parent: it };
    }
  }
  return null;
}

export async function updateAnywhere(id, mutate) {
  const f = findAnywhere(id);
  if (!f) return false;
  const items = clone(f.ws.items);
  const walk = (list) => {
    for (const it of list) {
      if (it.id === id) {
        mutate(it);
        return true;
      }
      if (it.type === 'group' && walk(it.items || [])) return true;
    }
    return false;
  };
  walk(items);
  await api.setItems(f.ws.id, items);
  return true;
}

export async function removeAnywhere(id) {
  const f = findAnywhere(id);
  if (!f) return;
  const items = clone(f.ws.items)
    .filter((i) => i.id !== id)
    .map((i) => (i.type === 'group' ? { ...i, items: (i.items || []).filter((k) => k.id !== id) } : i));
  await api.setItems(f.ws.id, items);
}

export function activeWs() {
  return P.config.workspaces.find((w) => w.id === P.config.activeWorkspace) || P.config.workspaces[0];
}

export const TYPE_LABEL = {
  app: 'Programa',
  file: 'Archivo',
  folder: 'Carpeta',
  url: 'Sitio web',
  group: 'Grupo',
  folderStack: 'Carpeta en vivo',
  recent: 'Archivos recientes',
  shelf: 'Estante',
  smart: 'Sugerencias',
  widget: 'Widget',
  action: 'Acción',
  separator: 'Separador',
};
