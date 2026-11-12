export const ESTADO_OK = 'Completo y en buen estado';

export type Incidencias = {
  conDano: boolean;
  sinCargador: boolean;
  notas: string;
};

export const SIN_INCIDENCIAS: Incidencias = { conDano: false, sinCargador: false, notas: '' };

export function construirEstadoEquipo({ conDano, sinCargador, notas }: Incidencias): string {
  let base: string;
  if (conDano && sinCargador) base = 'Con daño y falta cargador';
  else if (conDano) base = 'Con daño / Requiere revisión';
  else if (sinCargador) base = 'Falta cargador';
  else return ESTADO_OK;

  const texto = notas.trim();
  return texto ? `${base} · ${texto}` : base;
}
