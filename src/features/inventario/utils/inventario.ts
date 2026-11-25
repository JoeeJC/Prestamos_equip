import type { Categoria, Equipo } from '@/types/database';

export const STOCK_BAJO = 1;

export const ESTADOS_EQUIPO = ['Disponible', 'Reservado', 'En préstamo', 'En mantenimiento', 'Baja'] as const;
export type EstadoEquipo = Equipo['estado'];

export const ESTADOS_EDITABLES = ['Disponible', 'En mantenimiento', 'Baja'] as const;
export type EstadoEditable = (typeof ESTADOS_EDITABLES)[number];

export type FiltrosInventario = {
  texto: string;
  categoria: string;
  estado: EstadoEquipo | '';
};

export type ResumenCategoria = {
  id_categoria: string;
  nombre: string;
  total: number;
  sinBaja: number;
  disponibles: number;
  ocultos: number;
  conteos: Record<EstadoEquipo, number>;
  alerta: 'sin-stock' | 'stock-bajo' | null;
};

export function estadoBloqueado(estado: EstadoEquipo) {
  return estado === 'Reservado' || estado === 'En préstamo';
}

export function conteosPorEstado(equipos: Equipo[]): Record<EstadoEquipo, number> {
  const conteos = Object.fromEntries(ESTADOS_EQUIPO.map((estado) => [estado, 0])) as Record<EstadoEquipo, number>;
  equipos.forEach((equipo) => {
    conteos[equipo.estado] += 1;
  });
  return conteos;
}

export function calcularStockPorCategoria(categorias: Categoria[], equipos: Equipo[]): ResumenCategoria[] {
  return categorias.map((categoria) => {
    const deCategoria = equipos.filter((equipo) => equipo.id_categoria === categoria.id_categoria);
    const conteos = conteosPorEstado(deCategoria);
    const total = ESTADOS_EQUIPO.reduce((suma, estado) => suma + conteos[estado], 0);
    const sinBaja = total - conteos.Baja;
    const disponibles = conteos.Disponible;
    const ocultos = deCategoria.filter((equipo) => Boolean(equipo.oculto_catalogo) && equipo.estado !== 'Baja').length;
    let alerta: ResumenCategoria['alerta'] = null;
    if (sinBaja > 0 && disponibles === 0) alerta = 'sin-stock';
    else if (sinBaja > 0 && disponibles <= STOCK_BAJO) alerta = 'stock-bajo';
    return {
      id_categoria: categoria.id_categoria,
      nombre: categoria.nombre,
      total,
      sinBaja,
      disponibles,
      ocultos,
      conteos,
      alerta,
    };
  });
}

export function generarCodigos(base: string, cantidad: number): string[] | null {
  const coincidencia = base.match(/^(.*?)(\d+)$/);
  if (!coincidencia) return cantidad === 1 ? [base] : null;
  const [, prefijo, digitos] = coincidencia;
  const inicio = Number(digitos);
  return Array.from({ length: cantidad }, (_, indice) =>
    `${prefijo}${String(inicio + indice).padStart(digitos.length, '0')}`,
  );
}

export function esErrorDePostgres(error: { code?: string } | null, codigo: string) {
  return error?.code === codigo;
}

export function mensajeErrorEquipoDuplicado(
  error: { code?: string; message?: string } | null,
): string | null {
  if (!error || error.code !== '23505') return null;
  const msg = (error.message ?? '').toLowerCase();
  if (msg.includes('numero_serie') || msg.includes('serie')) {
    return 'Ya existe otro equipo registrado con ese número de serie.';
  }
  return 'Ya existe un equipo con ese código de inventario.';
}

export function coincideBusqueda(equipo: Equipo, texto: string) {
  const termino = texto.trim().toLowerCase();
  if (!termino) return true;
  return [
    equipo.codigo_inventario,
    equipo.numero_serie ?? '',
    equipo.marca_modelo ?? '',
    equipo.observaciones ?? '',
  ].some((valor) => valor.toLowerCase().includes(termino));
}
