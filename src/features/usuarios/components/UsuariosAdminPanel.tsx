import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, Edit3, FileSpreadsheet, RotateCcw, Search, Trash2, UserMinus, UserPlus, Users, X, } from 'lucide-react';
import BajaUsuarioModal from '@/features/usuarios/components/BajaUsuarioModal';
import Badge, { estadoUsuarioVariant } from '@/components/ui/Badge';
import ImportarExcelUsuariosModal from '@/features/usuarios/components/ImportarExcelUsuariosModal';
import UsuarioModal from '@/features/usuarios/components/UsuarioModal';
import { useAuth } from '@/context/AuthContext';
import type { Rol } from '@/types/database';
import {
  CURSOS_OPCIONES,
  cancelarBajaUsuario,
  cargarRoles,
  depurarBajasVencidas,
  diasRestantesBaja,
  listarUsuariosAdmin,
  type UsuarioAdmin,
} from '@/features/usuarios/services/usuariosService';

type Aviso = { tipo: 'exito' | 'error' | 'info'; texto: string };

const SIN_CURSO = '__sin_curso__';

function formatearFechaCorta(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function textoCuentaRegresiva(fechaBaja: string): string {
  const dias = diasRestantesBaja(fechaBaja);
  if (dias === null) return '';
  if (dias <= 0) return 'Vence hoy (esperando devolución activa)';
  if (dias === 1) return 'Se elimina en 1 día';
  return `Se elimina en ${dias} días`;
}

export default function UsuariosAdminPanel() {
  const { session } = useAuth();
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null);
  const [rolesDisponibles, setRolesDisponibles] = useState<Rol[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [procesandoId, setProcesandoId] = useState<string | null>(null);

  // Filtros
  const [busqueda, setBusqueda] = useState('');
  const [filtroCurso, setFiltroCurso] = useState('');
  const [filtroRol, setFiltroRol] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');

  // Modales
  const [modalUsuario, setModalUsuario] = useState<{ abierto: boolean; usuario: UsuarioAdmin | null }>({
    abierto: false,
    usuario: null,
  });
  const [modalBaja, setModalBaja] = useState<{
    usuario: UsuarioAdmin;
    modo: 'programada' | 'inmediata';
  } | null>(null);
  const [modalExcelAbierto, setModalExcelAbierto] = useState(false);

  const cargarTodo = useCallback(
    async (depurarPrimero = false) => {
      if (!session) return;
      setCargando(true);
      try {
        if (depurarPrimero) {
          const eliminados = await depurarBajasVencidas(session.token);
          if (eliminados > 0) {
            setAviso({
              tipo: 'info',
              texto: `Se depuraron automáticamente ${eliminados} cuenta${eliminados === 1 ? '' : 's'} cuya cuenta regresiva llegó a cero.`,
            });
          }
        }
        const [lista, roles] = await Promise.all([
          listarUsuariosAdmin(session.token),
          cargarRoles(),
        ]);
        setUsuarios(lista);
        setRolesDisponibles(roles);
      } catch (err) {
        setAviso({
          tipo: 'error',
          texto: err instanceof Error ? err.message : 'No se pudo cargar el padrón de usuarios.',
        });
      } finally {
        setCargando(false);
      }
    },
    [session],
  );

  useEffect(() => {
    void cargarTodo(true);
  }, [cargarTodo]);

  const filtrados = useMemo(() => {
    if (!usuarios) return [];
    const q = busqueda.trim().toLowerCase();
    return usuarios.filter((u) => {
      if (q) {
        const coincide =
          u.dni.toLowerCase().includes(q) ||
          u.nombre.toLowerCase().includes(q) ||
          u.apellido.toLowerCase().includes(q) ||
          `${u.nombre} ${u.apellido}`.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.curso ?? '').toLowerCase().includes(q);
        if (!coincide) return false;
      }

      if (filtroCurso) {
        if (filtroCurso === SIN_CURSO) {
          if (u.curso && u.curso.trim() !== '') return false;
        } else if ((u.curso ?? '').trim() !== filtroCurso) {
          return false;
        }
      }

      if (filtroRol && !u.roles.some((r) => r.id_rol === filtroRol)) {
        return false;
      }

      if (filtroEstado) {
        if (filtroEstado === 'baja_programada') {
          if (!u.fecha_baja_programada) return false;
        } else if (u.estado !== filtroEstado) {
          return false;
        }
      }

      return true;
    });
  }, [usuarios, busqueda, filtroCurso, filtroRol, filtroEstado]);

  const resumen = useMemo(() => {
    const lista = usuarios ?? [];
    return {
      total: lista.length,
      activos: lista.filter((u) => u.estado === 'Activo').length,
      sancionados: lista.filter((u) => u.estado === 'Sancionado').length,
      enBaja: lista.filter((u) => Boolean(u.fecha_baja_programada)).length,
    };
  }, [usuarios]);

  const hayFiltrosActivos = Boolean(busqueda || filtroCurso || filtroRol || filtroEstado);

  const limpiarFiltros = () => {
    setBusqueda('');
    setFiltroCurso('');
    setFiltroRol('');
    setFiltroEstado('');
  };

  const handleReactivar = async (u: UsuarioAdmin) => {
    if (!session) return;
    setProcesandoId(u.id_usuario);
    try {
      await cancelarBajaUsuario(session.token, u.id_usuario);
      setAviso({
        tipo: 'exito',
        texto: `Se canceló la baja de ${u.nombre} ${u.apellido} y volvió a estado Activo.`,
      });
      await cargarTodo(false);
    } catch (err) {
      setAviso({
        tipo: 'error',
        texto: err instanceof Error ? err.message : 'No se pudo cancelar la baja.',
      });
    } finally {
      setProcesandoId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Padrón de usuarios</h2>
          <p className="text-sm text-gray-500">
            Filtrá por curso o rol, editá datos y gestioná bajas con cuenta regresiva para egresados o jubilados.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setModalExcelAbierto(true)}
            className="btn-secondary"
            disabled={usuarios === null}
          >
            <FileSpreadsheet size={16} /> Importar Excel
          </button>
          <button
            type="button"
            onClick={() => setModalUsuario({ abierto: true, usuario: null })}
            className="btn-primary"
          >
            <UserPlus size={16} /> Nuevo usuario
          </button>
        </div>
      </div>

      {aviso && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
            aviso.tipo === 'error'
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300'
              : aviso.tipo === 'info'
                ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200'
                : 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-200'
          }`}
        >
          <span>{aviso.texto}</span>
          <button
            type="button"
            onClick={() => setAviso(null)}
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Cerrar aviso"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Métricas rápidas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-3.5">
          <p className="text-xs text-gray-500">Total en padrón</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{resumen.total}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-xs text-gray-500">Activos</p>
          <p className="mt-1 text-2xl font-semibold text-green-600 dark:text-green-400">{resumen.activos}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-xs text-gray-500">Sancionados</p>
          <p className="mt-1 text-2xl font-semibold text-amber-600 dark:text-amber-400">{resumen.sancionados}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-xs text-gray-500">En baja programada</p>
          <p className="mt-1 text-2xl font-semibold text-red-600 dark:text-red-400">{resumen.enBaja}</p>
        </div>
      </div>

      {/* Barra de filtros */}
      <div className="card p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input pl-9"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar DNI, nombre o email…"
            />
          </div>

          <select
            className="input"
            value={filtroCurso}
            onChange={(e) => setFiltroCurso(e.target.value)}
            aria-label="Filtrar por curso"
          >
            <option value="">Todos los cursos</option>
            {CURSOS_OPCIONES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={SIN_CURSO}>Sin curso</option>
          </select>

          <select
            className="input"
            value={filtroRol}
            onChange={(e) => setFiltroRol(e.target.value)}
            aria-label="Filtrar por rol"
          >
            <option value="">Todos los roles</option>
            {rolesDisponibles.map((r) => (
              <option key={r.id_rol} value={r.id_rol}>
                {r.nombre}
              </option>
            ))}
          </select>

          <select
            className="input"
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            <option value="Activo">Activo</option>
            <option value="Sancionado">Sancionado</option>
            <option value="Inactivo">Inactivo</option>
            <option value="baja_programada">Con baja programada</option>
          </select>
        </div>

        {hayFiltrosActivos && (
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>
              Mostrando {filtrados.length} de {usuarios?.length ?? 0} usuarios
            </span>
            <button type="button" onClick={limpiarFiltros} className="font-medium text-brand-600 hover:underline">
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      {/* Listado */}
      {usuarios === null ? (
        cargando ? (
          <div className="card flex items-center justify-center gap-2 px-6 py-12 text-sm text-gray-500">
            <Users size={16} className="animate-pulse text-brand-600" />
            Cargando padrón de usuarios…
          </div>
        ) : (
          <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-gray-500">
            <AlertTriangle size={20} className="text-red-600" />
            <p>No se pudo obtener el listado de usuarios.</p>
            <button type="button" onClick={() => void cargarTodo(false)} className="btn-secondary">
              Reintentar
            </button>
          </div>
        )
      ) : filtrados.length === 0 ? (
        <div className="card px-6 py-12 text-center text-sm text-gray-500">
          No hay usuarios que coincidan con los filtros seleccionados.
        </div>
      ) : (
        <>
          {/* Tabla escritorio */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wider text-gray-500 dark:border-gray-800 dark:bg-gray-900/60">
                <tr>
                  <th className="px-4 py-3 font-medium">Usuario</th>
                  <th className="px-4 py-3 font-medium">Curso</th>
                  <th className="px-4 py-3 font-medium">Roles</th>
                  <th className="px-4 py-3 font-medium">Estado / Baja</th>
                  <th className="px-4 py-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {filtrados.map((u) => {
                  const esYo = u.id_usuario === session?.usuario.id_usuario;
                  const ocupado = procesandoId === u.id_usuario;
                  return (
                    <tr key={u.id_usuario} className="hover:bg-gray-50/70 dark:hover:bg-gray-900/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-white">
                          {u.apellido}, {u.nombre}
                          {esYo && (
                            <span className="ml-2 text-xs font-normal text-brand-600 dark:text-brand-400">(Vos)</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          DNI {u.dni} · {u.email}
                          {u.telefono ? ` · ${u.telefono}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {u.curso || <span className="text-xs italic text-gray-400">Sin curso</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((r) => (
                            <Badge key={r.id_rol} variant="blue">
                              {r.nombre}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant={estadoUsuarioVariant(u.estado)}>{u.estado}</Badge>
                            {u.debe_cambiar_password && (
                              <Badge variant="yellow">Clave inicial pendiente</Badge>
                            )}
                          </div>
                          {u.fecha_baja_programada && (
                            <div className="space-y-0.5">
                              <Badge variant="red">
                                <CalendarClock size={12} />
                                {textoCuentaRegresiva(u.fecha_baja_programada)}
                              </Badge>
                              <p className="text-[11px] text-gray-500">
                                Fecha: {formatearFechaCorta(u.fecha_baja_programada)}
                                {u.motivo_baja ? ` · ${u.motivo_baja}` : ''}
                              </p>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setModalUsuario({ abierto: true, usuario: u })}
                            className="btn-ghost px-2.5 py-1.5 text-xs"
                            title="Editar datos, curso y roles"
                            disabled={ocupado}
                          >
                            <Edit3 size={14} /> Editar
                          </button>

                          {u.fecha_baja_programada ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleReactivar(u)}
                                className="btn-secondary px-2.5 py-1.5 text-xs"
                                disabled={ocupado}
                              >
                                <RotateCcw size={14} /> Cancelar baja
                              </button>
                              <button
                                type="button"
                                onClick={() => setModalBaja({ usuario: u, modo: 'inmediata' })}
                                className="btn-ghost px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                                disabled={ocupado || esYo}
                                title="Eliminar definitivamente ahora"
                              >
                                <Trash2 size={14} /> Eliminar ahora
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setModalBaja({ usuario: u, modo: 'programada' })}
                              className="btn-ghost px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                              disabled={ocupado || esYo}
                              title={esYo ? 'No podés dar de baja tu propia cuenta' : 'Dar de baja / eliminar'}
                            >
                              <UserMinus size={14} /> Dar de baja
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Tarjetas móvil */}
          <div className="space-y-3 md:hidden">
            {filtrados.map((u) => {
              const esYo = u.id_usuario === session?.usuario.id_usuario;
              const ocupado = procesandoId === u.id_usuario;
              return (
                <div key={u.id_usuario} className="card space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {u.apellido}, {u.nombre} {esYo && <span className="text-xs text-brand-600">(Vos)</span>}
                      </p>
                      <p className="text-xs text-gray-500">
                        DNI {u.dni} · {u.email}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                        {u.curso ? `Curso: ${u.curso}` : 'Sin curso'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={estadoUsuarioVariant(u.estado)}>{u.estado}</Badge>
                      {u.debe_cambiar_password && (
                        <Badge variant="yellow">Clave inicial</Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r.id_rol} variant="blue">
                        {r.nombre}
                      </Badge>
                    ))}
                  </div>

                  {u.fecha_baja_programada && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                      <div className="flex items-center gap-1.5 font-medium">
                        <CalendarClock size={14} />
                        <span>{textoCuentaRegresiva(u.fecha_baja_programada)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px]">
                        Eliminación: {formatearFechaCorta(u.fecha_baja_programada)}
                        {u.motivo_baja ? ` · ${u.motivo_baja}` : ''}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
                    <button
                      type="button"
                      onClick={() => setModalUsuario({ abierto: true, usuario: u })}
                      className="btn-secondary flex-1 py-1.5 text-xs"
                      disabled={ocupado}
                    >
                      <Edit3 size={14} /> Editar
                    </button>
                    {u.fecha_baja_programada ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleReactivar(u)}
                          className="btn-secondary flex-1 py-1.5 text-xs"
                          disabled={ocupado}
                        >
                          <RotateCcw size={14} /> Cancelar baja
                        </button>
                        <button
                          type="button"
                          onClick={() => setModalBaja({ usuario: u, modo: 'inmediata' })}
                          className="btn-danger py-1.5 text-xs"
                          disabled={ocupado || esYo}
                        >
                          <Trash2 size={14} /> Eliminar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setModalBaja({ usuario: u, modo: 'programada' })}
                        className="btn-ghost py-1.5 text-xs text-red-600 dark:text-red-400"
                        disabled={ocupado || esYo}
                      >
                        <UserMinus size={14} /> Dar de baja
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {modalUsuario.abierto && (
        <UsuarioModal
          usuario={modalUsuario.usuario}
          rolesDisponibles={rolesDisponibles}
          onCerrar={() => setModalUsuario({ abierto: false, usuario: null })}
          onGuardado={(mensaje) => {
            setModalUsuario({ abierto: false, usuario: null });
            setAviso({ tipo: 'exito', texto: mensaje });
            void cargarTodo(false);
          }}
        />
      )}

      {modalBaja && (
        <BajaUsuarioModal
          usuario={modalBaja.usuario}
          modoInicial={modalBaja.modo}
          onCerrar={() => setModalBaja(null)}
          onConfirmado={(mensaje) => {
            setModalBaja(null);
            setAviso({ tipo: 'exito', texto: mensaje });
            void cargarTodo(false);
          }}
        />
      )}

      {modalExcelAbierto && usuarios && (
        <ImportarExcelUsuariosModal
          usuariosExistentes={usuarios}
          rolesDisponibles={rolesDisponibles}
          onCerrar={() => setModalExcelAbierto(false)}
          onImportado={(mensaje) => {
            setAviso({ tipo: 'exito', texto: mensaje });
            void cargarTodo(false);
          }}
        />
      )}
    </div>
  );
}
