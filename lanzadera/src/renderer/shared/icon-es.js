// Búsqueda de iconos en español: traduce palabras comunes a las etiquetas en inglés de Lucide.
import { GLYPHS, TAGS, CATEGORIES } from './icon-bank.js';
import { normalize } from './dom.js';

const ES = {
  carpeta: 'folder', archivo: 'file', documento: 'file-text document', papel: 'paper file', hoja: 'sheet', tabla: 'table sheet', calculo: 'calculator sheet',
  musica: 'music', cancion: 'music song', audio: 'audio music', auricular: 'headphones', audifono: 'headphones', microfono: 'mic', altavoz: 'speaker volume', volumen: 'volume',
  video: 'video film', pelicula: 'film clapperboard movie', cine: 'film clapperboard popcorn', tele: 'tv', television: 'tv', camara: 'camera', foto: 'image camera photo', imagen: 'image picture', galeria: 'images gallery',
  juego: 'gamepad game joystick', videojuego: 'gamepad game', control: 'gamepad joystick', dado: 'dice', trofeo: 'trophy', medalla: 'medal', corona: 'crown', espada: 'sword', fantasma: 'ghost', rompecabezas: 'puzzle',
  correo: 'mail', email: 'mail', mensaje: 'message', chat: 'message chat', telefono: 'phone', llamada: 'phone call', enviar: 'send', compartir: 'share', contacto: 'contact user', persona: 'user person', usuario: 'user', gente: 'users people', grupo: 'users group',
  trabajo: 'briefcase work', oficina: 'briefcase building', maletin: 'briefcase', calendario: 'calendar', agenda: 'calendar notebook', reunion: 'users calendar video', presentacion: 'presentation', grafico: 'chart', estadistica: 'chart', lista: 'list', tarea: 'list-todo check', nota: 'sticky-note notebook', cuaderno: 'notebook', libro: 'book', biblioteca: 'library', lapiz: 'pencil', pluma: 'pen feather', escribir: 'pen pencil type', firma: 'signature pen',
  dinero: 'dollar coins banknote wallet', banco: 'landmark bank', tarjeta: 'credit-card', cartera: 'wallet', compra: 'shopping cart', tienda: 'store shopping', carrito: 'cart', regalo: 'gift', etiqueta: 'tag', precio: 'tag dollar', factura: 'receipt',
  web: 'globe', internet: 'globe wifi', mundo: 'globe earth', tierra: 'earth globe', nube: 'cloud', enlace: 'link', descarga: 'download', descargar: 'download', subir: 'upload', wifi: 'wifi', red: 'network wifi',
  codigo: 'code', programar: 'code terminal', terminal: 'terminal', consola: 'terminal', error: 'bug alert', bicho: 'bug', base: 'database', datos: 'database', servidor: 'server', robot: 'bot', cerebro: 'brain', ia: 'bot sparkles brain', inteligencia: 'brain sparkles',
  configuracion: 'settings cog', ajustes: 'settings sliders', engranaje: 'cog settings', herramienta: 'wrench hammer tool', martillo: 'hammer', llave: 'key wrench', candado: 'lock', seguridad: 'shield lock', escudo: 'shield', proteger: 'shield', clave: 'key lock',
  computadora: 'monitor laptop computer pc', ordenador: 'monitor laptop pc', pc: 'monitor pc', portatil: 'laptop', laptop: 'laptop', pantalla: 'monitor screen', monitor: 'monitor', movil: 'smartphone', celular: 'smartphone phone', tableta: 'tablet', teclado: 'keyboard', raton: 'mouse', impresora: 'printer', disco: 'hard-drive disc', memoria: 'memory cpu', bateria: 'battery', energia: 'zap battery power', apagar: 'power', encender: 'power',
  buscar: 'search', lupa: 'search zoom', estrella: 'star', favorito: 'star heart bookmark', corazon: 'heart', amor: 'heart', me: 'heart thumbs', fuego: 'flame fire', rayo: 'zap lightning', magia: 'wand sparkles', brillo: 'sparkles sun', idea: 'lightbulb', bombilla: 'lightbulb',
  casa: 'house home', hogar: 'house home', inicio: 'house home', edificio: 'building', escuela: 'school graduation', colegio: 'school', universidad: 'graduation-cap school', hospital: 'hospital', iglesia: 'church', fabrica: 'factory',
  mapa: 'map', lugar: 'map-pin', ubicacion: 'map-pin navigation', brujula: 'compass', viaje: 'plane luggage map', avion: 'plane', coche: 'car', auto: 'car', carro: 'car', bus: 'bus', tren: 'train', barco: 'ship sailboat', bicicleta: 'bike', moto: 'bike', maleta: 'luggage briefcase',
  comida: 'utensils food', cocina: 'chef cooking utensils', cafe: 'coffee', pizza: 'pizza', manzana: 'apple', fruta: 'apple cherry grape citrus', pastel: 'cake', torta: 'cake', helado: 'ice-cream', vino: 'wine', cerveza: 'beer', bebida: 'cup wine', restaurante: 'utensils',
  salud: 'heart activity stethoscope', medico: 'stethoscope', medicina: 'pill', pastilla: 'pill', deporte: 'dumbbell trophy', gimnasio: 'dumbbell', correr: 'footprints activity', bebe: 'baby',
  perro: 'dog', gato: 'cat', pajaro: 'bird', pez: 'fish', conejo: 'rabbit', flor: 'flower', arbol: 'tree', hoja_: 'leaf', planta: 'sprout leaf', sol: 'sun', luna: 'moon', lluvia: 'cloud-rain', nieve: 'snowflake', clima: 'cloud-sun', tiempo: 'cloud-sun clock', montana: 'mountain', mar: 'waves', agua: 'droplet waves', planeta: 'planet orbit',
  reloj: 'clock watch', alarma: 'alarm-clock', hora: 'clock', temporizador: 'timer hourglass', reciente: 'clock history', historial: 'history clock',
  papelera: 'trash', basura: 'trash', borrar: 'trash eraser', eliminar: 'trash x', mas: 'plus', menos: 'minus', cerrar: 'x', ok: 'check', listo: 'check', flecha: 'arrow', arriba: 'arrow-up', abajo: 'arrow-down',
  diseno: 'palette pen-tool brush', pintura: 'paintbrush palette', pincel: 'brush paintbrush', color: 'palette', paleta: 'palette', forma: 'shapes', cuadrado: 'square', circulo: 'circle', triangulo: 'triangle', recortar: 'scissors crop', tijera: 'scissors',
  comprimido: 'archive zip package', caja: 'box package', paquete: 'package box', instalar: 'package download', bandeja: 'inbox', guardar: 'save', copiar: 'copy', pegar: 'clipboard', portapapeles: 'clipboard',
  cohete: 'rocket', lanzar: 'rocket', fiesta: 'party', celebrar: 'party', musico: 'guitar music', guitarra: 'guitar', piano: 'piano', tambor: 'drum', radio: 'radio', podcast: 'podcast mic',
  noticias: 'newspaper', periodico: 'newspaper', idioma: 'languages', traducir: 'languages', escuela_: 'graduation-cap', ciencia: 'atom flask microscope', quimica: 'flask', fisica: 'atom',
  bloquear: 'lock', ojo: 'eye', ver: 'eye', ocultar: 'eye-off', campana: 'bell', notificacion: 'bell', marcador: 'bookmark', alfiler: 'pin', fijar: 'pin',
};

const TAG_INDEX = Object.keys(GLYPHS).map((name) => ({ name, hay: normalize(name.replace(/-/g, ' ') + ' ' + (TAGS[name] || '').replace(/,/g, ' ')) }));

export const CATEGORY_NAMES = {
  destacados: 'Destacados',
  apps: 'Apps y sistema',
  archivos: 'Archivos',
  multimedia: 'Multimedia',
  comunicacion: 'Comunicación',
  trabajo: 'Trabajo',
  ocio: 'Juegos y ocio',
  web: 'Web y nube',
  desarrollo: 'Programación',
  diseno: 'Diseño',
  naturaleza: 'Naturaleza',
  compras: 'Compras y dinero',
  lugares: 'Lugares y viajes',
  comida: 'Comida',
  salud: 'Salud y deporte',
  formas: 'Formas y flechas',
  todos: 'Todos',
};

export function iconsInCategory(cat) {
  if (cat === 'todos') return Object.keys(GLYPHS);
  return CATEGORIES[cat] || [];
}

export function searchIcons(query, limit = 400) {
  const q = normalize(query);
  if (!q) return [];
  const terms = new Set([q]);
  for (const [es, en] of Object.entries(ES)) {
    const key = es.replace(/_$/, '');
    if (key.startsWith(q) || (q.length >= 4 && q.startsWith(key))) for (const t of en.split(' ')) terms.add(t);
  }
  const scored = [];
  for (const { name, hay } of TAG_INDEX) {
    let s = 0;
    for (const t of terms) {
      if (name === t) s = Math.max(s, 100);
      else if (name.startsWith(t)) s = Math.max(s, 80);
      else if (hay.includes(t)) s = Math.max(s, t === q ? 60 : 50);
    }
    if (s) scored.push([name, s - name.length * 0.1]);
  }
  return scored
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map((x) => x[0]);
}
