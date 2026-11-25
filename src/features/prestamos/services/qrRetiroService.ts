import { supabase } from '@/services/supabaseClient';
import type { DetallePrestamo, Prestamo, Usuario } from '@/types/database';

export type PrestamoPorCodigo = Prestamo & {
  usuarios?: Pick<Usuario, 'id_usuario' | 'dni' | 'nombre' | 'apellido' | 'estado'>;
  detalle_prestamos?: DetallePrestamo[];
};

export function extraerCodigoRetiro(raw: string): string {
  const texto = raw.trim();
  if (!texto) return '';

  // Soporta URL completa con ?retiro=CODIGO
  try {
    if (/^https?:\/\//i.test(texto) || texto.includes('retiro=')) {
      const url = texto.startsWith('http')
        ? new URL(texto)
        : new URL(texto, 'https://itu.local');
      const param = url.searchParams.get('retiro');
      if (param) {
        return param.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      }
    }
  } catch {
    // Si no es URL válida continuamos con la extracción simple
  }

  // Soporta prefijo ITU-RETIRO:CODIGO
  const sinPrefijo = texto.replace(/^ITU-?RETIRO:/i, '');
  return sinPrefijo.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function construirPayloadQR(codigo: string): string {
  const limpio = extraerCodigoRetiro(codigo);
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/?retiro=${limpio}`;
  }
  return `ITU-RETIRO:${limpio}`;
}

export async function buscarPrestamoPorCodigo(
  token: string,
  rawCodigo: string,
): Promise<PrestamoPorCodigo> {
  const codigo = extraerCodigoRetiro(rawCodigo);
  if (codigo.length < 4) {
    throw new Error('Ingresá o escaneá un código de retiro válido.');
  }

  const { data, error } = await supabase.rpc('admin_buscar_prestamo_por_codigo', {
    p_token: token,
    p_codigo: codigo,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No encontramos ninguna reserva con el código ${codigo}.`);
  return data as PrestamoPorCodigo;
}

export function etiquetaMetodoEntrega(metodo?: string | null): string | null {
  if (metodo === 'qr') return 'Entrega confirmada (QR)';
  if (metodo === 'codigo') return 'Entrega confirmada (Código)';
  return null;
}

export function etiquetaMetodoDevolucion(metodo?: string | null): string | null {
  if (metodo === 'qr') return 'Devolución confirmada (QR)';
  if (metodo === 'codigo') return 'Devolución confirmada (Código)';
  return null;
}
