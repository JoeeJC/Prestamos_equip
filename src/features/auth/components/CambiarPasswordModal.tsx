import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, ShieldAlert } from 'lucide-react';
import ModalFrame from '@/components/ui/ModalFrame';
import { useAuth } from '@/context/AuthContext';

export default function CambiarPasswordModal({
  obligatorio = false,
  onCerrar,
  onGuardado,
}: {
  obligatorio?: boolean;
  onCerrar?: () => void;
  onGuardado: () => void;
}) {
  const { session, cambiarPassword, logout } = useAuth();
  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNueva, setPasswordNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [verActual, setVerActual] = useState(false);
  const [verNueva, setVerNueva] = useState(false);
  const [verConfirmacion, setVerConfirmacion] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!passwordActual) {
      setError('Ingresá tu contraseña actual.');
      return;
    }
    if (passwordNueva.length < 6) {
      setError('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (passwordNueva.trim() === session.usuario.dni.trim()) {
      setError('La nueva contraseña no puede ser igual a tu DNI.');
      return;
    }
    if (passwordNueva === passwordActual) {
      setError('Elegí una contraseña diferente a la actual.');
      return;
    }
    if (passwordNueva !== confirmacion) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }

    setEnviando(true);
    try {
      await cambiarPassword(passwordActual, passwordNueva);
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la contraseña.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <ModalFrame
      titulo={obligatorio ? 'Creá tu contraseña personal' : 'Cambiar contraseña'}
      onCerrar={() => {
        if (!obligatorio && !enviando) onCerrar?.();
      }}
      ocultarCerrar={obligatorio}
      footer={
        <>
          {obligatorio ? (
            <button type="button" onClick={logout} className="btn-secondary" disabled={enviando}>
              Cerrar sesión
            </button>
          ) : (
            <button type="button" onClick={onCerrar} className="btn-secondary" disabled={enviando}>
              Cancelar
            </button>
          )}
          <button type="submit" form="cambiar-password-form" className="btn-primary" disabled={enviando}>
            {enviando
              ? 'Guardando…'
              : obligatorio
                ? 'Guardar y continuar'
                : 'Actualizar contraseña'}
          </button>
        </>
      }
    >
      <form id="cambiar-password-form" onSubmit={enviar} className="space-y-4">
        {obligatorio ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <p className="font-semibold">Primer ingreso o clave restablecida</p>
              <p>
                Por seguridad, tenés que cambiar tu contraseña inicial (tu DNI) por una clave personal de al menos{' '}
                <strong>6 caracteres</strong> antes de usar el sistema.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-300">
            <KeyRound size={16} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
            <p>
              Elegí una clave de al menos <strong>6 caracteres</strong> y distinta de tu DNI ({session.usuario.dni}).
            </p>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
            Contraseña actual *
          </label>
          <div className="relative">
            <input
              type={verActual ? 'text' : 'password'}
              className="input pr-10"
              value={passwordActual}
              onChange={(e) => setPasswordActual(e.target.value)}
              placeholder={obligatorio ? 'Ingresá tu DNI o clave actual' : 'Tu contraseña actual'}
              autoFocus
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setVerActual((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label={verActual ? 'Ocultar contraseña actual' : 'Ver contraseña actual'}
            >
              {verActual ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
            Nueva contraseña *
          </label>
          <div className="relative">
            <input
              type={verNueva ? 'text' : 'password'}
              className="input pr-10"
              value={passwordNueva}
              onChange={(e) => setPasswordNueva(e.target.value)}
              placeholder="Mínimo 6 caracteres (distinta al DNI)"
              minLength={6}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              onClick={() => setVerNueva((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label={verNueva ? 'Ocultar nueva contraseña' : 'Ver nueva contraseña'}
            >
              {verNueva ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
            Confirmar nueva contraseña *
          </label>
          <div className="relative">
            <input
              type={verConfirmacion ? 'text' : 'password'}
              className="input pr-10"
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              placeholder="Repetí la nueva contraseña"
              minLength={6}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              onClick={() => setVerConfirmacion((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label={verConfirmacion ? 'Ocultar confirmación' : 'Ver confirmación'}
            >
              {verConfirmacion ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}
      </form>
    </ModalFrame>
  );
}
