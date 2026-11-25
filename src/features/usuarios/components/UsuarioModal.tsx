import { useState, FormEvent } from 'react';
import { KeyRound, RotateCcw } from 'lucide-react';
import ModalFrame from '@/components/ui/ModalFrame';
import { useAuth } from '@/context/AuthContext';
import type { Rol, Usuario } from '@/types/database';
import {
  actualizarUsuarioAdmin,
  crearUsuarioAdmin,
  CURSOS_OPCIONES,
  restablecerPasswordUsuarioAdmin,
  type UsuarioAdmin,
} from '@/features/usuarios/services/usuariosService';

const ESTADOS_USUARIO: Usuario['estado'][] = ['Activo', 'Sancionado', 'Inactivo'];

export default function UsuarioModal({
  usuario,
  rolesDisponibles,
  onCerrar,
  onGuardado,
}: {
  usuario: UsuarioAdmin | null;
  rolesDisponibles: Rol[];
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  const { session } = useAuth();
  const esEdicion = usuario !== null;
  const esCuentaPropia = usuario?.id_usuario === session?.usuario.id_usuario;

  const rolEstudiante = rolesDisponibles.find((r) => r.nombre === 'Estudiante');

  const [dni, setDni] = useState(usuario?.dni ?? '');
  const [nombre, setNombre] = useState(usuario?.nombre ?? '');
  const [apellido, setApellido] = useState(usuario?.apellido ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [telefono, setTelefono] = useState(usuario?.telefono ?? '');
  const [curso, setCurso] = useState(() => {
    const actual = usuario?.curso?.trim() ?? '';
    return (CURSOS_OPCIONES as readonly string[]).includes(actual) ? actual : '';
  });
  const [estado, setEstado] = useState<Usuario['estado']>(usuario?.estado ?? 'Activo');
  const [rolesSeleccionados, setRolesSeleccionados] = useState<string[]>(() => {
    if (usuario) return usuario.roles.map((r) => r.id_rol);
    return rolEstudiante ? [rolEstudiante.id_rol] : [];
  });
  const [usarDniComoClave, setUsarDniComoClave] = useState(true);
  const [passwordInicial, setPasswordInicial] = useState('');
  const [confirmandoReset, setConfirmandoReset] = useState(false);
  const [reseteando, setReseteando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ocupado = enviando || reseteando;

  const toggleRol = (idRol: string) => {
    setRolesSeleccionados((prev) =>
      prev.includes(idRol) ? prev.filter((id) => id !== idRol) : [...prev, idRol],
    );
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setError(null);

    const dniLimpio = dni.trim();
    if (!dniLimpio || !nombre.trim() || !apellido.trim() || !email.trim()) {
      setError('DNI, nombre, apellido y correo electrónico son obligatorios.');
      return;
    }

    if (rolesSeleccionados.length === 0) {
      setError('Seleccioná al menos un rol para el usuario.');
      return;
    }

    const passwordEfectiva = usarDniComoClave ? dniLimpio : passwordInicial;
    if (!esEdicion && passwordEfectiva.length < 6) {
      setError(
        usarDniComoClave
          ? 'El DNI debe tener al menos 6 caracteres para usarlo como contraseña inicial.'
          : 'La contraseña inicial debe tener al menos 6 caracteres.',
      );
      return;
    }

    setEnviando(true);
    try {
      if (esEdicion && usuario) {
        await actualizarUsuarioAdmin(session.token, usuario.id_usuario, {
          dni: dniLimpio,
          nombre: nombre.trim(),
          apellido: apellido.trim(),
          email: email.trim(),
          telefono: telefono.trim(),
          curso: curso.trim(),
          estado,
          roles: rolesSeleccionados,
        });
        onGuardado(`Se actualizaron los datos de ${nombre.trim()} ${apellido.trim()}.`);
      } else {
        await crearUsuarioAdmin(session.token, {
          dni: dniLimpio,
          nombre: nombre.trim(),
          apellido: apellido.trim(),
          email: email.trim(),
          telefono: telefono.trim(),
          curso: curso.trim(),
          password: passwordEfectiva,
          estado,
          roles: rolesSeleccionados,
        });
        onGuardado(
          passwordEfectiva.trim() === dniLimpio
            ? `Se dio de alta a ${nombre.trim()} ${apellido.trim()} con clave inicial igual a su DNI.`
            : `Se dio de alta a ${nombre.trim()} ${apellido.trim()} en el padrón.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el usuario.');
    } finally {
      setEnviando(false);
    }
  };

  const handleRestablecerAlDni = async () => {
    if (!session || !usuario) return;
    setError(null);
    setReseteando(true);
    try {
      await restablecerPasswordUsuarioAdmin(session.token, usuario.id_usuario);
      onGuardado(
        `Se restableció la contraseña de ${usuario.nombre} ${usuario.apellido} a su DNI (${usuario.dni}). Deberá cambiarla al ingresar.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo restablecer la contraseña.');
      setConfirmandoReset(false);
    } finally {
      setReseteando(false);
    }
  };

  return (
    <ModalFrame
      titulo={esEdicion ? 'Editar usuario del padrón' : 'Nuevo usuario en el padrón'}
      onCerrar={onCerrar}
      footer={
        <>
          <button type="button" onClick={onCerrar} className="btn-secondary" disabled={ocupado}>
            Cancelar
          </button>
          <button type="submit" form="usuario-admin-form" className="btn-primary" disabled={ocupado}>
            {enviando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </>
      }
    >
      <form id="usuario-admin-form" onSubmit={enviar} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              DNI *
            </label>
            <input
              className="input"
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              placeholder="Ej: 39123456"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Estado
            </label>
            <select
              className="input"
              value={estado}
              onChange={(e) => setEstado(e.target.value as Usuario['estado'])}
              disabled={esCuentaPropia}
            >
              {ESTADOS_USUARIO.map((est) => (
                <option key={est} value={est}>
                  {est}
                </option>
              ))}
            </select>
            {esCuentaPropia && (
              <p className="mt-1 text-[11px] text-gray-500">
                No podés cambiar el estado de tu propia cuenta.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Nombre *
            </label>
            <input
              className="input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Lucía"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Apellido *
            </label>
            <input
              className="input"
              value={apellido}
              onChange={(e) => setApellido(e.target.value)}
              placeholder="Ej: Gómez"
              required
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Correo electrónico *
            </label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@itu.edu.ar"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Teléfono
            </label>
            <input
              className="input"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
            Curso
          </label>
          <select
            className="input"
            value={curso}
            onChange={(e) => setCurso(e.target.value)}
          >
            <option value="">Sin curso / No aplica</option>
            {CURSOS_OPCIONES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300">
            Roles asignados *
          </span>
          <div className="grid gap-2 sm:grid-cols-2">
            {rolesDisponibles.map((rol) => {
              const checked = rolesSeleccionados.includes(rol.id_rol);
              return (
                <label
                  key={rol.id_rol}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    checked
                      ? 'border-brand-500 bg-brand-50/70 text-brand-900 dark:border-brand-500 dark:bg-brand-950/50 dark:text-brand-100'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRol(rol.id_rol)}
                    className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="font-medium">{rol.nombre}</span>
                </label>
              );
            })}
          </div>
        </div>

        {!esEdicion ? (
          <div className="space-y-2.5 rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 dark:border-gray-800 dark:bg-gray-900/40">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={usarDniComoClave}
                onChange={(e) => setUsarDniComoClave(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span>
                <span className="font-medium text-gray-900 dark:text-white">
                  Usar DNI como contraseña inicial
                </span>
                <span className="block text-[11px] text-gray-500">
                  En su primer ingreso, el sistema le pedirá crear una contraseña personal.
                </span>
              </span>
            </label>

            {usarDniComoClave ? (
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
                Contraseña inicial automática:{' '}
                <strong className="font-mono text-gray-900 dark:text-white">
                  {dni.trim() || 'Completá el DNI arriba'}
                </strong>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                  Contraseña inicial personalizada *
                </label>
                <input
                  type="password"
                  className="input"
                  value={passwordInicial}
                  onChange={(e) => setPasswordInicial(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  minLength={6}
                  required
                />
              </div>
            )}
          </div>
        ) : (
          !esCuentaPropia &&
          usuario && (
            <div className="space-y-2.5 rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 dark:border-gray-800 dark:bg-gray-900/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-200">
                  <KeyRound size={15} className="text-brand-600 dark:text-brand-400" />
                  <span>Seguridad y contraseña</span>
                </div>
                {usuario.debe_cambiar_password && (
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                    Cambio pendiente al ingresar
                  </span>
                )}
              </div>

              {confirmandoReset ? (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                  <p>
                    ¿Restablecer la contraseña de <strong>{usuario.nombre} {usuario.apellido}</strong> a su DNI (
                    <strong className="font-mono">{usuario.dni}</strong>)? Se cerrarán sus sesiones activas y deberá
                    elegir una clave nueva al entrar.
                  </p>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmandoReset(false)}
                      className="btn-secondary px-2.5 py-1 text-xs"
                      disabled={reseteando}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRestablecerAlDni()}
                      className="btn-primary px-2.5 py-1 text-xs"
                      disabled={reseteando}
                    >
                      {reseteando ? 'Restableciendo…' : 'Confirmar restablecimiento'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-gray-500">
                    Si olvidó su contraseña, podés volverla a su DNI para que ingrese y la cambie.
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfirmandoReset(true)}
                    className="btn-secondary px-2.5 py-1.5 text-xs"
                    disabled={ocupado}
                  >
                    <RotateCcw size={13} /> Restablecer clave al DNI
                  </button>
                </div>
              )}
            </div>
          )
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
