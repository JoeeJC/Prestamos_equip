import { supabase } from '@/lib/supabase';

export async function verificarYCaducarReservasVencidas(): Promise<number> {
  const { data, error } = await supabase.rpc('cancelar_reservas_vencidas');
  if (error) throw new Error(error.message);
  if (typeof data !== 'number') throw new Error('Respuesta inesperada al caducar reservas');
  return data;
}
