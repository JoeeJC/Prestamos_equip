import { useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarClock, Trash2 } from 'lucide-react';
import ModalFrame from '@/components/ui/ModalFrame';
import { useAuth } from '@/context/AuthContext';
import { MOTIVOS_BAJA, programarBajaUsuario, type UsuarioAdmin } from '@/features/usuarios/services/usuariosService';

const PRESETS_DIAS = [7, 15, 30, 60];

function calcularFechaObjetivo(dias: number): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function BajaUsuarioModal({
  usuario,
  modoInicial = 'programada',
  onCerrar,
  onConfirmado,
}: {
  usuario: UsuarioAdmin;
  modoInicial?: 'programada' | 'inmediata';
  onCerrar: () => void;
  onConfirmado: (mensaje: string) => void;
}) {
  const { session } = useAuth();
  const [modo, setModo] = useState<'programada' | 'inmediata'>(modoInicial);
  const [dias, setDias] = useState<number>(30);
  const [motivoSeleccionado, setMotivoSeleccionado] = useState<string>(
    usuario.motivo_baja && MOTIVOS_BAJA.includes(usuario.motivo_baja)
      ? usuario.motivo_baja
      : usuario.motivo_baja
        ? 'Otro'
        : MOTIVOS_BAJA[0],
  );
  const [motivoPersonalizado, setMotivoPersonalizado] = useState<string>(
    usuario.motivo_baja && !MOTIVOS_BAJA.includes(usuario.motivo_baja) ? usuario.motivo_baja : '',
  );
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fechaObjetivo = useMemo(() => {
    const num = Number.isFinite(dias) ? Math.max(1, Math.min(365, Math.round(dias))) : 30;
    return calcularFechaObjetivo(num);
  }, [dias]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setError(null);

    const diasFinal = modo === 'inmediata' ? 0 : Math.round(dias);
    if (modo === 'programada' && (!Number.isFinite(diasFinal) || diasFinal < 1 || diasFinal > 365)) {
      setError('Ingresá un plazo entre 1 y 365 días para la cuenta regresiva.');
      return;
    }

    const motivoFinal =
      motivoSeleccionado === 'Otro'
        ? motivoPersonalizado.trim() || 'Otro motivo de baja'
        : motivoSeleccionado;

    setEnviando(true);
    try {
      const resultado = await programarBajaUsuario(
        session.token,
        usuario.id_usuario,
        diasFinal,
        motivoFinal,
      );

      if (resultado === 'eliminado') {
        onConfirmado(`Se eliminó definitivamente a ${usuario.nombre} ${usuario.apellido} de la base de datos.`);
      } else {
        onConfirmado(
          `Se programó la baja de ${usuario.nombre} ${usuario.apellido} en ${diasFinal} día${diasFinal === 1 ? '' : 's'} (el ${fechaObjetivo}).`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar la baja del usuario.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <ModalFrame
      titulo="Dar de baja del establecimiento"
      onCerrar={onCerrar}
      footer={
        <>
          <button type="button" onClick={onCerrar} className="btn-secondary" disabled={enviando}>
            Cancelar
          </button>
          <button
            type="submit"
            form="baja-usuario-form"
            className="btn-danger"
            disabled={enviando}
          >
            {enviando
              ? 'Procesando…'
              : modo === 'inmediata'
                ? 'Eliminar definitivamente'
                : 'Iniciar cuenta regresiva'}
          </button>
        </>
      }
    >
      <form id="baja-usuario-form" onSubmit={enviar} className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-900/60">
          <p className="font-semibold text-gray-900 dark:text-white">
            {usuario.nombre} {usuario.apellido}
          </p>
          <p className="text-xs text-gray-500">
            DNI {usuario.dni}{usuario.curso ? ` · Curso ${usuario.curso}` : ` · ${usuario.email}`}
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
            Motivo de la baja
          </label>
          <select
            className="input"
            value={motivoSeleccionado}
            onChange={(e) => setMotivoSeleccionado(e.target.value)}
          >
            {MOTIVOS_BAJA.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {motivoSeleccionado === 'Otro' && (
            <input
              className="input mt-2"
              value={motivoPersonalizado}
              onChange={(e) => setMotivoPersonalizado(e.target.value)}
              placeholder="Especificá el motivo…"
            />
          )}
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            Modalidad de eliminación
          </span>

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
              modo === 'programada'
                ? 'border-brand-500 bg-brand-50/60 dark:border-brand-500 dark:bg-brand-950/30'
                : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900'
            }`}
          >
            <input
              type="radio"
              name="modo-baja"
              checked={modo === 'programada'}
              onChange={() => setModo('programada')}
              className="mt-1 text-brand-600 focus:ring-brand-500"
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white">
                <CalendarClock size={15} className="text-brand-600" />
                <span>Cuenta regresiva en días (recomendado)</span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                Pasa a estado <strong>Inactivo</strong> de inmediato (no puede ingresar ni reservar) y se borra
                automáticamente de la base al cumplirse el plazo.
              </p>
            </div>
          </label>

          {modo === 'programada' && (
            <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {PRESETS_DIAS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDias(preset)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      dias === preset
                        ? 'bg-brand-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    {preset} días
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <div className="w-32">
                  <label className="mb-1 block text-[11px] font-medium text-gray-500">
                    Plazo (1–365 días)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="input"
                    value={dias}
                    onChange={(e) => setDias(Number(e.target.value))}
                  />
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  Eliminación automática prevista:
                  <p className="font-semibold text-gray-900 dark:text-white">{fechaObjetivo}</p>
                </div>
              </div>
            </div>
          )}

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
              modo === 'inmediata'
                ? 'border-red-500 bg-red-50/70 dark:border-red-500 dark:bg-red-950/30'
                : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900'
            }`}
          >
            <input
              type="radio"
              name="modo-baja"
              checked={modo === 'inmediata'}
              onChange={() => setModo('inmediata')}
              className="mt-1 text-red-600 focus:ring-red-500"
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-300">
                <Trash2 size={15} />
                <span>Eliminar ahora de la base de datos</span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                Borra al usuario y su historial de préstamos cerrados en el acto. Se bloquea si tiene reservas o
                equipos pendientes de devolución.
              </p>
            </div>
          </label>
        </div>

        {modo === 'inmediata' && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>Esta acción es irreversible. Si el usuario pudiera volver o necesitás resguardo, elegí la cuenta regresiva.</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
      </form>
    </ModalFrame>
  );
}
