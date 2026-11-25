import * as XLSX from 'xlsx';
import type { EstadoEditable } from '@/features/inventario/utils/inventario';
import type { Categoria, Equipo } from '@/types/database';

export type CampoExcelEquipo =
  | 'codigo_inventario'
  | 'numero_serie'
  | 'marca_modelo'
  | 'categoria'
  | 'estado'
  | 'oculto_catalogo'
  | 'observaciones';

export type FilaExcelEquipo = {
  filaNumero: number;
  accion: 'crear' | 'actualizar' | 'error';
  errores: string[];
  codigo_inventario: string;
  numero_serie: string;
  marca_modelo: string;
  id_categoria: string;
  categoriaNombre: string;
  estado: EstadoEditable;
  oculto_catalogo: boolean;
  observaciones: string;
  idEquipoExistente?: string;
  estadoExistente?: Equipo['estado'];
  sugerenciaMantenimiento?: boolean;
  sugerenciaOculto?: boolean;
};

export type ResultadoParseoExcelEquipos = {
  columnasDetectadas: { campo: CampoExcelEquipo; encabezadoOriginal: string }[];
  columnasIgnoradas: string[];
  columnasFaltantes: CampoExcelEquipo[];
  tieneColumnaSerie: boolean;
  tieneColumnaMarca: boolean;
  tieneColumnaCategoria: boolean;
  tieneColumnaEstado: boolean;
  tieneColumnaOculto: boolean;
  tieneColumnaObservaciones: boolean;
  filas: FilaExcelEquipo[];
};

const ALIAS_ENCABEZADOS: Record<CampoExcelEquipo, string[]> = {
  codigo_inventario: [
    'n inventario',
    'no inventario',
    'nro inventario',
    'numero inventario',
    'numero de inventario',
    'n de inventario',
    'inventario',
    'codigo inventario',
    'codigo de inventario',
    'cod inventario',
    'codigo',
    'cod',
  ],
  numero_serie: [
    'n serie',
    'no serie',
    'nro serie',
    'numero serie',
    'numero de serie',
    'n de serie',
    'serie',
    'serial',
    'sn',
    's n',
  ],
  marca_modelo: [
    'marca modelo',
    'marca y modelo',
    'marca',
    'modelo',
  ],
  categoria: [
    'categoria',
    'tipo',
    'tipo equipo',
    'tipo de equipo',
    'rubro',
  ],
  estado: [
    'estado',
    'situacion',
    'condicion',
  ],
  oculto_catalogo: [
    'oculto',
    'oculto catalogo',
    'oculto en catalogo',
    'ocultar',
    'ocultar en catalogo',
    'interno',
    'solo admin',
  ],
  observaciones: [
    'observaciones',
    'observacion',
    'obs',
    'nota',
    'notas',
    'detalle',
    'detalles',
    'comentarios',
    'comentario',
  ],
};

function normalizarTexto(valor: unknown): string {
  return String(valor ?? '')
    .replace(/[º°]/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function limpiarCelda(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

function mapearEncabezado(raw: unknown): CampoExcelEquipo | null {
  const norm = normalizarTexto(raw);
  if (!norm) return null;
  for (const campo of Object.keys(ALIAS_ENCABEZADOS) as CampoExcelEquipo[]) {
    if (ALIAS_ENCABEZADOS[campo].includes(norm)) return campo;
  }
  return null;
}

function normalizarEstadoExcel(raw: unknown): { valido: boolean; valor: EstadoEditable } {
  const limpio = limpiarCelda(raw);
  if (!limpio) return { valido: true, valor: 'Disponible' };
  const norm = normalizarTexto(limpio);
  if (['disponible', 'ok', 'activo', 'operativo'].includes(norm)) {
    return { valido: true, valor: 'Disponible' };
  }
  if (['en mantenimiento', 'mantenimiento', 'reparacion', 'taller', 'mant'].includes(norm)) {
    return { valido: true, valor: 'En mantenimiento' };
  }
  if (['baja', 'dado de baja', 'dada de baja', 'descartado'].includes(norm)) {
    return { valido: true, valor: 'Baja' };
  }
  return { valido: false, valor: 'Disponible' };
}

function normalizarOcultoExcel(raw: unknown): boolean {
  const norm = normalizarTexto(raw);
  return ['si', 'true', '1', 'oculto', 'oculta', 'ocultar', 'interno', 'x'].includes(norm);
}

function detectarSugerenciaMantenimiento(obs: string): boolean {
  const norm = normalizarTexto(obs);
  if (!norm) return false;
  return [
    'no enciende',
    'mantenimiento',
    'reparar',
    'reparacion',
    'roto',
    'rota',
    'falla',
    'no funciona',
    'no anda',
    'municipio',
    'service',
    'danado',
    'danada',
    'averiado',
    'sin bateria',
    'pantalla rota',
  ].some((kw) => norm.includes(kw));
}

function detectarSugerenciaOculto(obs: string): boolean {
  const norm = normalizarTexto(obs);
  if (!norm) return false;
  return [
    'administrac',
    'uso profesores',
    'solo profesores',
    'uso interno',
    'solo admin',
    'oculto',
    'oculta',
  ].some((kw) => norm.includes(kw));
}

export function leerLibroExcelEquipos(buffer: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: 'array' });
}

export function parsearHojaEquipos(
  wb: XLSX.WorkBook,
  sheetName: string,
  equiposExistentes: Equipo[],
  categorias: Categoria[],
  categoriaPorDefectoId: string,
  marcaPorDefecto: string,
  inferirPorObservaciones = true,
): ResultadoParseoExcelEquipos {
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return {
      columnasDetectadas: [],
      columnasIgnoradas: [],
      columnasFaltantes: ['codigo_inventario'],
      tieneColumnaSerie: false,
      tieneColumnaMarca: false,
      tieneColumnaCategoria: false,
      tieneColumnaEstado: false,
      tieneColumnaOculto: false,
      tieneColumnaObservaciones: false,
      filas: [],
    };
  }

  const matriz = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', blankrows: false });
  if (matriz.length === 0) {
    return {
      columnasDetectadas: [],
      columnasIgnoradas: [],
      columnasFaltantes: ['codigo_inventario'],
      tieneColumnaSerie: false,
      tieneColumnaMarca: false,
      tieneColumnaCategoria: false,
      tieneColumnaEstado: false,
      tieneColumnaOculto: false,
      tieneColumnaObservaciones: false,
      filas: [],
    };
  }

  let headerRowIdx = 0;
  let mejorPuntaje = -1;
  const limiteBusqueda = Math.min(matriz.length, 5);
  for (let i = 0; i < limiteBusqueda; i++) {
    const row = matriz[i] ?? [];
    const encontrados = new Set<CampoExcelEquipo>();
    for (const cell of row) {
      const m = mapearEncabezado(cell);
      if (m) encontrados.add(m);
    }
    if (encontrados.size > mejorPuntaje) {
      mejorPuntaje = encontrados.size;
      headerRowIdx = i;
    }
  }

  const headerRow = matriz[headerRowIdx] ?? [];
  const indicePorCampo = new Map<CampoExcelEquipo, number>();
  const columnasDetectadas: { campo: CampoExcelEquipo; encabezadoOriginal: string }[] = [];
  const columnasIgnoradas: string[] = [];

  headerRow.forEach((cell, colIdx) => {
    const raw = limpiarCelda(cell);
    const campo = mapearEncabezado(raw);
    if (campo && !indicePorCampo.has(campo)) {
      indicePorCampo.set(campo, colIdx);
      columnasDetectadas.push({ campo, encabezadoOriginal: raw });
    } else if (raw) {
      columnasIgnoradas.push(raw);
    }
  });

  const columnasFaltantes: CampoExcelEquipo[] = indicePorCampo.has('codigo_inventario')
    ? []
    : ['codigo_inventario'];

  const tieneColumnaSerie = indicePorCampo.has('numero_serie');
  const tieneColumnaMarca = indicePorCampo.has('marca_modelo');
  const tieneColumnaCategoria = indicePorCampo.has('categoria');
  const tieneColumnaEstado = indicePorCampo.has('estado');
  const tieneColumnaOculto = indicePorCampo.has('oculto_catalogo');
  const tieneColumnaObservaciones = indicePorCampo.has('observaciones');

  if (columnasFaltantes.length > 0) {
    return {
      columnasDetectadas,
      columnasIgnoradas,
      columnasFaltantes,
      tieneColumnaSerie,
      tieneColumnaMarca,
      tieneColumnaCategoria,
      tieneColumnaEstado,
      tieneColumnaOculto,
      tieneColumnaObservaciones,
      filas: [],
    };
  }

  const equipoPorCodigo = new Map<string, Equipo>();
  const equipoPorSerie = new Map<string, Equipo>();
  for (const eq of equiposExistentes) {
    equipoPorCodigo.set(eq.codigo_inventario.trim().toLowerCase(), eq);
    const serieNorm = eq.numero_serie?.trim().toUpperCase();
    if (serieNorm) {
      equipoPorSerie.set(serieNorm, eq);
    }
  }

  const categoriaPorNombre = new Map<string, Categoria>();
  const categoriaPorId = new Map<string, Categoria>();
  for (const cat of categorias) {
    categoriaPorNombre.set(normalizarTexto(cat.nombre), cat);
    categoriaPorId.set(cat.id_categoria, cat);
  }

  const catDefecto = categoriaPorId.get(categoriaPorDefectoId) ?? categorias[0];
  const codigosVistos = new Set<string>();
  const seriesVistas = new Set<string>();
  const filas: FilaExcelEquipo[] = [];

  for (let r = headerRowIdx + 1; r < matriz.length; r++) {
    const row = matriz[r] ?? [];
    if (row.every((c) => limpiarCelda(c) === '')) continue;

    const get = (campo: CampoExcelEquipo): unknown => {
      const idx = indicePorCampo.get(campo);
      return idx === undefined ? '' : row[idx];
    };

    const codigo = limpiarCelda(get('codigo_inventario'));
    const serieRaw = limpiarCelda(get('numero_serie'));
    const marcaRaw = limpiarCelda(get('marca_modelo'));
    const catRaw = limpiarCelda(get('categoria'));
    const estadoRaw = limpiarCelda(get('estado'));
    const ocultoRaw = get('oculto_catalogo');
    const obsRaw = limpiarCelda(get('observaciones'));

    // Ignorar filas auxiliares sin Nº Inventario ni Serie ni Observaciones
    if (!codigo && !serieRaw && !obsRaw) continue;

    const errores: string[] = [];
    const codigoKey = codigo.toLowerCase();
    const existente = codigo ? equipoPorCodigo.get(codigoKey) : undefined;

    if (!codigo) {
      errores.push('Falta Nº Inventario / Código');
    } else if (codigosVistos.has(codigoKey)) {
      errores.push('Código duplicado en el archivo');
    } else {
      codigosVistos.add(codigoKey);
    }

    const numero_serie = tieneColumnaSerie ? serieRaw : existente?.numero_serie ?? '';
    const serieKey = numero_serie.trim().toUpperCase();
    if (serieKey) {
      if (seriesVistas.has(serieKey)) {
        errores.push('N° de serie duplicado en el archivo');
      } else {
        seriesVistas.add(serieKey);
        const otroConSerie = equipoPorSerie.get(serieKey);
        if (otroConSerie && otroConSerie.id_equipo !== existente?.id_equipo) {
          errores.push(`N° de serie ya usado en el equipo ${otroConSerie.codigo_inventario}`);
        }
      }
    }

    let catResuelta = catDefecto;
    if (tieneColumnaCategoria && catRaw) {
      const encontrada = categoriaPorNombre.get(normalizarTexto(catRaw));
      if (!encontrada) {
        errores.push(`Categoría "${catRaw}" no existe en el sistema`);
      } else {
        catResuelta = encontrada;
      }
    } else if (existente) {
      catResuelta = categoriaPorId.get(existente.id_categoria) ?? catDefecto;
    }

    if (!catResuelta) {
      errores.push('Sin categoría seleccionada');
    }

    let estado: EstadoEditable = 'Disponible';
    let sugerenciaMantenimiento = false;
    if (tieneColumnaEstado && estadoRaw) {
      const estRes = normalizarEstadoExcel(estadoRaw);
      if (!estRes.valido) {
        errores.push(`Estado "${estadoRaw}" inválido (usar Disponible, En mantenimiento o Baja)`);
      } else {
        estado = estRes.valor;
      }
    } else if (inferirPorObservaciones && detectarSugerenciaMantenimiento(obsRaw)) {
      estado = 'En mantenimiento';
      sugerenciaMantenimiento = true;
    } else if (existente && (existente.estado === 'En mantenimiento' || existente.estado === 'Baja')) {
      estado = existente.estado;
    }

    let oculto_catalogo = false;
    let sugerenciaOculto = false;
    if (tieneColumnaOculto && limpiarCelda(ocultoRaw) !== '') {
      oculto_catalogo = normalizarOcultoExcel(ocultoRaw);
    } else if (inferirPorObservaciones && detectarSugerenciaOculto(obsRaw)) {
      oculto_catalogo = true;
      sugerenciaOculto = true;
    } else if (existente) {
      oculto_catalogo = Boolean(existente.oculto_catalogo);
    }

    const marca_modelo =
      tieneColumnaMarca && marcaRaw
        ? marcaRaw
        : marcaPorDefecto.trim() || existente?.marca_modelo || '';
    const observaciones = tieneColumnaObservaciones ? obsRaw : existente?.observaciones ?? '';

    filas.push({
      filaNumero: r + 1,
      accion: errores.length > 0 ? 'error' : existente ? 'actualizar' : 'crear',
      errores,
      codigo_inventario: codigo,
      numero_serie,
      marca_modelo,
      id_categoria: catResuelta?.id_categoria ?? '',
      categoriaNombre: catResuelta?.nombre ?? '—',
      estado,
      oculto_catalogo,
      observaciones,
      idEquipoExistente: existente?.id_equipo,
      estadoExistente: existente?.estado,
      sugerenciaMantenimiento,
      sugerenciaOculto,
    });
  }

  return {
    columnasDetectadas,
    columnasIgnoradas,
    columnasFaltantes,
    tieneColumnaSerie,
    tieneColumnaMarca,
    tieneColumnaCategoria,
    tieneColumnaEstado,
    tieneColumnaOculto,
    tieneColumnaObservaciones,
    filas,
  };
}

export function descargarPlantillaEquiposExcel(): void {
  const filasEjemplo = [
    {
      Orden: 1,
      'Nº Inventario': '10778',
      'Nº Serie': 'CX30M1522081124',
      'Marca / Modelo': 'Notebook CX',
      Categoría: 'Notebook',
      Estado: 'Disponible',
      'Oculto en catálogo': 'No',
      Observaciones: '',
    },
    {
      Orden: 2,
      'Nº Inventario': '10790',
      'Nº Serie': 'CX30M1522081158',
      'Marca / Modelo': 'Notebook CX',
      Categoría: 'Notebook',
      Estado: 'Disponible',
      'Oculto en catálogo': 'Sí',
      Observaciones: 'Administrac.',
    },
    {
      Orden: 3,
      'Nº Inventario': '10807',
      'Nº Serie': 'CX30M1522081149',
      'Marca / Modelo': 'Notebook CX',
      Categoría: 'Notebook',
      Estado: 'En mantenimiento',
      'Oculto en catálogo': 'No',
      Observaciones: 'No enciende. Matias',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(filasEjemplo);
  ws['!cols'] = [
    { wch: 8 },
    { wch: 16 },
    { wch: 22 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 28 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Equipos');
  XLSX.writeFile(wb, 'plantilla_equipos_itu.xlsx');
}
