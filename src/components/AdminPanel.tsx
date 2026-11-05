import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  PackageCheck,
  PlusCircle,
  PackageX,
  Search,
  Users,
  X,
} from 'lucide-react';
import { supabase, type DetallePrestamo, type Equipo, type Prestamo, type Usuario } from '@/lib/supabase';
import Badge, { estadoPrestamoVariant, estadoUsuarioVariant } from '@/components/Badge';

type PrestamoAdmin = Prestamo & {
  usuarios?: Pick<Usuario, 'id_usuario' | 'dni' | 'nombre' | 'apellido' | 'estado'>;
  detalle_prestamos?: (DetallePrestamo & { equipos?: Equipo & { categorias_equipo?: any } })[];
};

type FiltroPrestamos = 'todos' | 'Reservado' | 'En Curso' | 'Devuelto';

function fechaLocalISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sumarDias(fecha: string, dias: number) {
  const [year, month, day] = fecha.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + dias);
  return fechaLocalISO(date);
}

function formatoFecha(fecha: string) {
  const [year, month, day] = fecha.split('-');
  return `${day}/${month}/${year}`;
}

function formatoHora(fecha: string | null) {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export default function AdminPanel() {
  const [dni, setDni] = useState('');
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [prestamos, setPrestamos] = useState<PrestamoAdmin[]>([]);
  const [prestamosFecha, setPrestamosFecha] = useState<PrestamoAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<{
    tipo: 'entregar' | 'recibir';
    id_prestamo: string;
  } | null>(null);
  const [estados, setEstados] = useState<Record<string, string>>({});
  const [aMantenimiento, setAMantenimiento] = useState<Record<string, boolean>>({});
  const [obs, setObs] = useState('');
  const [fechaFiltro, setFechaFiltro] = useState(() => fechaLocalISO());
  const [showSelectedDate, setShowSelectedDate] = useState(true);
  const [filtroPrestamos, setFiltroPrestamos] = useState<FiltroPrestamos>('todos');
  const [usuariosSugeridos, setUsuariosSugeridos] = useState<Usuario[]>([]);
  const [buscandoUsuarios, setBuscandoUsuarios] = useState(false);
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false);
  const buscadorRef = useRef<HTMLDivElement>(null);
  const omitirSiguienteSugerencia = useRef(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickDni, setQuickDni] = useState('');
  const [quickUser, setQuickUser] = useState<Usuario | null>(null);
  const [quickError, setQuickError] = useState('');
  const [quickValidating, setQuickValidating] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [equiposDisponibles, setEquiposDisponibles] = useState<Equipo[]>([]);
  const [equiposSeleccionados, setEquiposSeleccionados] = useState<Record<string, string>>({});
  const [quickObs, setQuickObs] = useState('');
  const [quickHoraInicio, setQuickHoraInicio] = useState('');
  const [quickDuracion, setQuickDuracion] = useState(1);
  const [quickUsuariosSugeridos, setQuickUsuariosSugeridos] = useState<Usuario[]>([]);
  const [quickBuscandoUsuarios, setQuickBuscandoUsuarios] = useState(false);
  const [quickMostrarSugerencias, setQuickMostrarSugerencias] = useState(false);
  const quickBuscadorRef = useRef<HTMLDivElement>(null);

  const buscar = async (documento = dni.trim()) => {
    setLoading(true);
    setNotFound(false);
    setUsuario(null);
    setPrestamos([]);
    const d = documento;
    if (!d) {
      setLoading(false);
      return;
    }
    const { data: u } = await supabase
      .from('usuarios')
      .select('*, usuario_roles(roles(*))')
      .eq('dni', d)
      .maybeSingle();
    if (!u) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setUsuario(u as unknown as Usuario);
    const { data: p } = await supabase
      .from('prestamos')
      .select('*, usuarios(id_usuario, dni, nombre, apellido, estado), detalle_prestamos(*, equipos(*, categorias_equipo(*)))')
      .eq('id_usuario', (u as any).id_usuario)
      .order('fecha_prestamo', { ascending: false })
      .order('hora_inicio_prevista', { ascending: false });
    setPrestamos((p ?? []) as PrestamoAdmin[]);
    setLoading(false);
  };

  const cargarPrestamosPorFecha = async (fecha: string) => {
    setLoading(true);
    const { data } = await supabase
      .from('prestamos')
      .select('*, usuarios(id_usuario, dni, nombre, apellido, estado), detalle_prestamos(*, equipos(*, categorias_equipo(*)))')
      .eq('fecha_prestamo', fecha)
      .order('hora_inicio_prevista');
    setPrestamosFecha((data ?? []) as PrestamoAdmin[]);
    setLoading(false);
  };

  useEffect(() => {
    cargarPrestamosPorFecha(fechaFiltro);
  }, [fechaFiltro]);

  useEffect(() => {
    const termino = dni.trim();
    if (omitirSiguienteSugerencia.current) {
      omitirSiguienteSugerencia.current = false;
      return;
    }
    if (termino.length < 2) {
      setUsuariosSugeridos([]);
      setMostrarSugerencias(false);
      setBuscandoUsuarios(false);
      return;
    }

    setMostrarSugerencias(true);
    setBuscandoUsuarios(true);
    const timer = window.setTimeout(async () => {
      const { data } = await supabase
        .from('usuarios')
        .select('id_usuario, dni, nombre, apellido, email, estado')
        .or(`dni.ilike.%${termino}%,nombre.ilike.%${termino}%,apellido.ilike.%${termino}%`)
        .limit(6);
      setUsuariosSugeridos((data ?? []) as Usuario[]);
      setBuscandoUsuarios(false);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dni]);

  useEffect(() => {
    const termino = quickDni.trim();
    if (!quickOpen || quickUser || termino.length < 2) {
      setQuickUsuariosSugeridos([]);
      setQuickMostrarSugerencias(false);
      setQuickBuscandoUsuarios(false);
      return;
    }

    setQuickMostrarSugerencias(true);
    setQuickBuscandoUsuarios(true);
    const timer = window.setTimeout(async () => {
      const { data } = await supabase
        .from('usuarios')
        .select('id_usuario, dni, nombre, apellido, email, estado, usuario_roles(roles(*))')
        .or(`dni.ilike.%${termino}%,nombre.ilike.%${termino}%,apellido.ilike.%${termino}%`)
        .limit(5);
      setQuickUsuariosSugeridos((data ?? []) as unknown as Usuario[]);
      setQuickBuscandoUsuarios(false);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [quickDni, quickOpen, quickUser]);

  useEffect(() => {
    const cerrarAlHacerClickFuera = (event: MouseEvent) => {
      if (buscadorRef.current && !buscadorRef.current.contains(event.target as Node)) {
        setMostrarSugerencias(false);
      }
    };
    document.addEventListener('mousedown', cerrarAlHacerClickFuera);
    return () => document.removeEventListener('mousedown', cerrarAlHacerClickFuera);
  }, []);

  useEffect(() => {
    const cerrarBuscadorRapidoAlHacerClickFuera = (event: MouseEvent) => {
      if (quickBuscadorRef.current && !quickBuscadorRef.current.contains(event.target as Node)) {
        setQuickMostrarSugerencias(false);
      }
    };
    document.addEventListener('mousedown', cerrarBuscadorRapidoAlHacerClickFuera);
    return () => document.removeEventListener('mousedown', cerrarBuscadorRapidoAlHacerClickFuera);
  }, []);

  const seleccionarUsuario = (seleccionado: Usuario) => {
    omitirSiguienteSugerencia.current = true;
    setDni(seleccionado.dni);
    setMostrarSugerencias(false);
    setUsuariosSugeridos([]);
    buscar(seleccionado.dni);
  };

  const seleccionarUsuarioRapido = (seleccionado: Usuario) => {
    setQuickDni(seleccionado.dni);
    setQuickMostrarSugerencias(false);
    setQuickUsuariosSugeridos([]);
    if (seleccionado.estado === 'Sancionado') {
      setQuickUser(null);
      setQuickError('Este usuario está sancionado y no puede retirar equipos');
      return;
    }
    setQuickError('');
    setQuickUser(seleccionado);
  };

  const prepararPrestamoRapido = async () => {
    const ahora = new Date();
    const horaRedondeada = ahora.getMinutes() >= 30 ? ahora.getHours() + 1 : ahora.getHours();
    const horaInicio = Math.min(Math.max(horaRedondeada, 0), 21);
    setQuickHoraInicio(`${String(horaInicio).padStart(2, '0')}:00`);
    setQuickDuracion(1);
    setQuickDni('');
    setQuickUser(null);
    setQuickError('');
    setEquiposSeleccionados({});
    setQuickObs('');
    setQuickOpen(true);
    const { data } = await supabase
      .from('equipos')
      .select('*, categorias_equipo(*)')
      .eq('estado', 'Disponible')
      .order('codigo_inventario');
    setEquiposDisponibles((data ?? []) as Equipo[]);
  };

  const validarDniRapido = async () => {
    const documento = quickDni.trim();
    setQuickError('');
    setQuickUser(null);
    if (!documento) {
      setQuickError('Ingresá un DNI para continuar.');
      return;
    }
    setQuickValidating(true);
    const { data, error } = await supabase
      .from('usuarios')
      .select('*, usuario_roles(roles(*))')
      .eq('dni', documento)
      .maybeSingle();
    setQuickValidating(false);
    if (error || !data) {
      setQuickError('DNI no registrado');
      return;
    }
    const validado = data as unknown as Usuario;
    if (validado.estado === 'Sancionado') {
      setQuickError('Usuario sancionado');
      return;
    }
    setQuickUser(validado);
  };

  const crearPrestamoRapido = async () => {
    if (!quickUser) {
      setQuickError('Validá el DNI del solicitante antes de continuar.');
      return;
    }
    const equipos = Object.entries(equiposSeleccionados);
    if (equipos.length === 0) {
      setQuickError('Seleccioná al menos un equipo.');
      return;
    }
    const [horaInicio] = quickHoraInicio.split(':').map(Number);
    const horaFin = horaInicio + quickDuracion;
    if (horaFin > 22) {
      setQuickError('La hora de devolución no puede superar las 22:00 hs.');
      return;
    }

    setQuickSaving(true);
    setQuickError('');
    try {
      const { data: prestamo, error: prestamoError } = await supabase
        .from('prestamos')
        .insert({
          id_usuario: quickUser.id_usuario,
          fecha_prestamo: fechaLocalISO(),
          hora_inicio_prevista: quickHoraInicio,
          hora_fin_prevista: `${String(horaFin).padStart(2, '0')}:00`,
          hora_retiro_real: new Date().toISOString(),
          estado: 'En Curso',
          observaciones_entrega: quickObs.trim() || null,
        })
        .select('id_prestamo')
        .single();
      if (prestamoError || !prestamo) throw new Error('No se pudo crear el préstamo.');

      const { error: detalleError } = await supabase
        .from('detalle_prestamos')
        .insert(equipos.map(([idEquipo, estadoSalida]) => ({
          id_prestamo: prestamo.id_prestamo,
          id_equipo: idEquipo,
          estado_salida: estadoSalida.trim() || null,
        })));
      if (detalleError) throw new Error('No se pudieron registrar los equipos del préstamo.');

      const { error: equiposError } = await supabase
        .from('equipos')
        .update({ estado: 'En préstamo' })
        .in('id_equipo', equipos.map(([idEquipo]) => idEquipo));
      if (equiposError) throw new Error('No se pudo actualizar el estado de los equipos.');

      setQuickOpen(false);
      setFechaFiltro(fechaLocalISO());
      await cargarPrestamosPorFecha(fechaLocalISO());
    } catch (error) {
      setQuickError(error instanceof Error ? error.message : 'No se pudo crear el préstamo.');
    } finally {
      setQuickSaving(false);
    }
  };

  const openEdit = (p: PrestamoAdmin, tipo: 'entregar' | 'recibir') => {
    setEdit({ tipo, id_prestamo: p.id_prestamo });
    const map: Record<string, string> = {};
    (p.detalle_prestamos ?? []).forEach((d) => {
      map[d.id_detalle] = tipo === 'entregar' ? d.estado_salida ?? '' : d.estado_devolucion ?? '';
    });
    setEstados(map);
    setAMantenimiento({});
    setObs(tipo === 'entregar' ? p.observaciones_entrega ?? '' : p.observaciones_devolucion ?? '');
  };

  const guardar = async () => {
    if (!edit) return;
    const p = [...prestamos, ...prestamosFecha].find((x) => x.id_prestamo === edit.id_prestamo);
    if (!p) return;
    setBusy(p.id_prestamo);
    try {
      const detalles = p.detalle_prestamos ?? [];
      for (const d of detalles) {
        const val = estados[d.id_detalle] ?? '';
        if (edit.tipo === 'entregar') {
          await supabase
            .from('detalle_prestamos')
            .update({ estado_salida: val })
            .eq('id_detalle', d.id_detalle);
        } else {
          await supabase
            .from('detalle_prestamos')
            .update({ estado_devolucion: val })
            .eq('id_detalle', d.id_detalle);
        }
      }

      if (edit.tipo === 'entregar') {
        await supabase
          .from('prestamos')
          .update({
            estado: 'En Curso',
            hora_retiro_real: new Date().toISOString(),
            observaciones_entrega: obs,
          })
          .eq('id_prestamo', p.id_prestamo);
        await supabase
          .from('equipos')
          .update({ estado: 'En préstamo' })
          .in(
            'id_equipo',
            detalles.map((d) => d.id_equipo),
          );
      } else {
        await supabase
          .from('prestamos')
          .update({
            estado: 'Devuelto',
            hora_devolucion_real: new Date().toISOString(),
            observaciones_devolucion: obs,
          })
          .eq('id_prestamo', p.id_prestamo);
        const equiposConFallas = detalles.filter((d) => aMantenimiento[d.id_detalle]);
        const equiposSinFallas = detalles.filter((d) => !aMantenimiento[d.id_detalle]);

        if (equiposSinFallas.length > 0) {
          await supabase
            .from('equipos')
            .update({ estado: 'Disponible' })
            .in(
              'id_equipo',
              equiposSinFallas.map((d) => d.id_equipo),
            );
        }

        for (const detalle of equiposConFallas) {
          const dano = estados[detalle.id_detalle]?.trim();
          const observacionActual = detalle.equipos?.observaciones?.trim();
          const observaciones = dano
            ? `${observacionActual ? `${observacionActual} | ` : ''}Daño en devolución: ${dano}`
            : observacionActual || 'Equipo marcado para mantenimiento en la devolución';

          await supabase
            .from('equipos')
            .update({ estado: 'En mantenimiento', observaciones })
            .eq('id_equipo', detalle.id_equipo);
        }
      }

      setEdit(null);
      await cargarPrestamosPorFecha(fechaFiltro);
      if (dni.trim()) await buscar();
    } finally {
      setBusy(null);
    }
  };

  const fechaHoy = fechaLocalISO();
  const esHoy = fechaFiltro === fechaHoy;
  const tituloOperativo = esHoy ? 'Préstamos de hoy' : `Préstamos del ${formatoFecha(fechaFiltro)}`;
  const conteosPrestamos = {
    todos: prestamosFecha.length,
    Reservado: prestamosFecha.filter((p) => p.estado === 'Reservado').length,
    'En Curso': prestamosFecha.filter((p) => p.estado === 'En Curso').length,
    Devuelto: prestamosFecha.filter((p) => p.estado === 'Devuelto').length,
  };
  const prestamosVisibles = filtroPrestamos === 'todos'
    ? prestamosFecha
    : prestamosFecha.filter((p) => p.estado === filtroPrestamos);
  const mensajeFiltroVacio: Record<FiltroPrestamos, string> = {
    todos: `No hay préstamos ni reservas para el ${formatoFecha(fechaFiltro)}.`,
    Reservado: 'No hay reservas pendientes de entrega.',
    'En Curso': 'No hay equipos en uso en este momento.',
    Devuelto: 'No hay préstamos devueltos para esta fecha.',
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Panel de Administrador</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Buscá un usuario por DNI y gestioná la entrega y devolución de equipos.
          </p>
        </div>
        <button type="button" onClick={prepararPrestamoRapido} className="btn-primary shrink-0">
          <PlusCircle size={16} /> Préstamo en mostrador
        </button>
      </div>

      {/* Buscador por DNI */}
      <div className="card mb-5 p-4">
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Buscar usuario por DNI
        </label>
        <div className="flex gap-2">
          <div ref={buscadorRef} className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Ej: 34000001"
              inputMode="numeric"
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              onFocus={() => dni.trim().length >= 2 && setMostrarSugerencias(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') buscar();
                if (e.key === 'Escape') setMostrarSugerencias(false);
              }}
            />
            {mostrarSugerencias && (
              <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                {buscandoUsuarios ? (
                  <p className="px-4 py-3 text-sm text-gray-500">Buscando…</p>
                ) : usuariosSugeridos.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-500">No se encontraron usuarios</p>
                ) : (
                  <ul>
                    {usuariosSugeridos.map((usuarioSugerido) => (
                      <li key={usuarioSugerido.id_usuario}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => seleccionarUsuario(usuarioSugerido)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">
                              {usuarioSugerido.nombre} {usuarioSugerido.apellido}
                            </span>
                            <span className="block truncate text-xs text-gray-500">
                              DNI {usuarioSugerido.dni} · {usuarioSugerido.email}
                            </span>
                          </span>
                          <Badge variant={estadoUsuarioVariant(usuarioSugerido.estado)}>{usuarioSugerido.estado}</Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={() => buscar()} className="btn-primary">
            <Search size={16} /> Buscar
          </button>
        </div>
        {notFound && (
          <p className="mt-2 text-sm text-red-600">No se encontró ningún usuario con ese DNI.</p>
        )}
      </div>

      {/* Usuario encontrado */}
      {usuario && (
        <div className="card mb-5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                <Users size={18} />
              </div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {usuario.nombre} {usuario.apellido}
                </p>
                <p className="text-xs text-gray-500">
                  DNI {usuario.dni} · {usuario.email}
                </p>
              </div>
            </div>
            <Badge variant={estadoUsuarioVariant(usuario.estado)}>{usuario.estado}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {((usuario as any).usuario_roles ?? [])
              .map((r: any) => r.roles?.nombre)
              .filter(Boolean)
              .map((r: string) => (
                <Badge key={r} variant="blue">
                  {r}
                </Badge>
              ))}
          </div>
        </div>
      )}

      {/* Sección: préstamos del usuario */}
      {usuario && prestamos.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
            <ClipboardList size={16} className="text-brand-600" /> Préstamos del usuario
          </h2>
          <div className="space-y-3">
            {prestamos.map((p) => (
              <PrestamoCard
                key={p.id_prestamo}
                p={p}
                busy={busy === p.id_prestamo}
                onEntregar={(p2) => openEdit(p2, 'entregar')}
                onRecibir={(p2) => openEdit(p2, 'recibir')}
              />
            ))}
          </div>
        </div>
      )}

      {/* Préstamos operativos por fecha */}
      <div>
        <div className="mb-3 flex flex-col gap-3 rounded-lg bg-gray-100 px-4 py-3 dark:bg-gray-800 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setShowSelectedDate((s) => !s)}
            className="flex items-center gap-2 text-left text-sm font-semibold text-gray-800 dark:text-gray-100"
          >
            <PackageCheck size={16} className="text-brand-600" />
            <span>{tituloOperativo} · {prestamosFecha.length}</span>
            <span className="ml-1 text-xs font-normal text-gray-500">
              {showSelectedDate ? 'Ocultar' : 'Mostrar'}
            </span>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFechaFiltro(sumarDias(fechaFiltro, -1))}
              className="btn-secondary h-9 w-9 !px-0"
              aria-label="Día anterior"
            >
              <ChevronLeft size={17} />
            </button>
            <input
              type="date"
              className="input h-9 sm:w-44"
              value={fechaFiltro}
              onChange={(e) => setFechaFiltro(e.target.value)}
              aria-label="Seleccionar fecha"
            />
            <button
              type="button"
              onClick={() => setFechaFiltro(sumarDias(fechaFiltro, 1))}
              className="btn-secondary h-9 w-9 !px-0"
              aria-label="Día siguiente"
            >
              <ChevronRight size={17} />
            </button>
            <button
              type="button"
              onClick={() => setFechaFiltro(fechaHoy)}
              className={`btn h-9 ${esHoy ? 'bg-brand-600 text-white' : 'btn-secondary'}`}
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={() => setFechaFiltro(sumarDias(fechaHoy, 1))}
              className="btn-secondary h-9"
            >
              Mañana
            </button>
          </div>
        </div>

        {showSelectedDate && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-950">
              {([
                { id: 'todos' as const, label: 'Todos', icon: ClipboardList },
                { id: 'Reservado' as const, label: 'Por entregar', icon: PackageCheck },
                { id: 'En Curso' as const, label: 'En uso', icon: PackageX },
                { id: 'Devuelto' as const, label: 'Devueltos', icon: Calendar },
              ]).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFiltroPrestamos(id)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    filtroPrestamos === id
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${
                    filtroPrestamos === id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  }`}>{conteosPrestamos[id]}</span>
                </button>
              ))}
            </div>
            {loading ? (
              <div className="card flex items-center justify-center gap-2 px-6 py-10 text-sm text-gray-500">
                <Calendar size={16} className="animate-pulse text-brand-600" />
                Cargando préstamos del {formatoFecha(fechaFiltro)}…
              </div>
            ) : prestamosVisibles.length === 0 ? (
              <div className="card px-6 py-10 text-center text-sm text-gray-500">
                {mensajeFiltroVacio[filtroPrestamos]}
              </div>
            ) : (
              prestamosVisibles.map((p) => (
                <PrestamoCard
                  key={p.id_prestamo}
                  p={p}
                  busy={busy === p.id_prestamo}
                  onEntregar={(p2) => openEdit(p2, 'entregar')}
                  onRecibir={(p2) => openEdit(p2, 'recibir')}
                  showUser
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Modal de préstamo rápido */}
      {quickOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-card dark:bg-gray-950 sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Préstamo en mostrador</h2>
                <p className="text-xs text-gray-500">Validá al solicitante y entregá los equipos en el momento.</p>
              </div>
              <button type="button" onClick={() => setQuickOpen(false)} className="btn-ghost h-9 w-9 !px-0">
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-5">
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Solicitante</label>
                <div ref={quickBuscadorRef} className="relative">
                  <input
                    className="input"
                    value={quickDni}
                    onChange={(e) => {
                      setQuickDni(e.target.value);
                      setQuickUser(null);
                      setQuickError('');
                    }}
                    onFocus={() => quickDni.trim().length >= 2 && !quickUser && setQuickMostrarSugerencias(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') validarDniRapido();
                      if (e.key === 'Escape') setQuickMostrarSugerencias(false);
                    }}
                    placeholder="Buscar por DNI, nombre o apellido..."
                  />
                  {quickMostrarSugerencias && (
                    <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                      {quickBuscandoUsuarios ? (
                        <p className="px-4 py-3 text-sm text-gray-500">Buscando…</p>
                      ) : quickUsuariosSugeridos.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-gray-500">No se encontraron usuarios</p>
                      ) : (
                        <ul>
                          {quickUsuariosSugeridos.map((usuarioSugerido) => (
                            <li key={usuarioSugerido.id_usuario}>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => seleccionarUsuarioRapido(usuarioSugerido)}
                                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">
                                    {usuarioSugerido.nombre} {usuarioSugerido.apellido}
                                  </span>
                                  <span className="block truncate text-xs text-gray-500">
                                    DNI {usuarioSugerido.dni} · {usuarioSugerido.email}
                                  </span>
                                </span>
                                <Badge variant={estadoUsuarioVariant(usuarioSugerido.estado)}>{usuarioSugerido.estado}</Badge>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
                {quickUser && (
                  <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950/20">
                    <div>
                      <p className="font-medium text-green-800 dark:text-green-300">
                        {quickUser.nombre} {quickUser.apellido}
                      </p>
                      <p className="text-xs text-green-700 dark:text-green-400">
                        DNI {quickUser.dni} · {((quickUser as any).usuario_roles ?? []).map((r: any) => r.roles?.nombre).filter(Boolean).join(', ') || 'Sin rol asignado'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickUser(null);
                        setQuickDni('');
                        setQuickError('');
                      }}
                      className="btn-ghost h-8 w-8 !px-0"
                      aria-label="Cambiar usuario"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                {quickError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{quickError}</p>}
              </div>

              <div className="mb-5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Equipos disponibles</label>
                  <span className="text-xs text-gray-500">{Object.keys(equiposSeleccionados).length} seleccionados</span>
                </div>
                {equiposDisponibles.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700">
                    No hay equipos disponibles en este momento.
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {equiposDisponibles.map((equipo) => {
                      const seleccionado = Object.prototype.hasOwnProperty.call(equiposSeleccionados, equipo.id_equipo);
                      return (
                        <div key={equipo.id_equipo} className={`rounded-lg border p-3 transition-colors ${seleccionado ? 'border-brand-300 bg-brand-50/50 dark:border-brand-800 dark:bg-brand-950/20' : 'border-gray-200 dark:border-gray-800'}`}>
                          <label className="flex cursor-pointer items-start gap-3">
                            <input
                              type="checkbox"
                              checked={seleccionado}
                              onChange={(e) => {
                                setEquiposSeleccionados((actuales) => {
                                  const siguiente = { ...actuales };
                                  if (e.target.checked) siguiente[equipo.id_equipo] = 'Buen estado';
                                  else delete siguiente[equipo.id_equipo];
                                  return siguiente;
                                });
                              }}
                              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-gray-900 dark:text-white">{equipo.codigo_inventario}</span>
                              <span className="block text-xs text-gray-500">{equipo.categorias_equipo?.nombre} · {equipo.marca_modelo ?? '—'}</span>
                            </span>
                          </label>
                          {seleccionado && (
                            <input
                              className="input mt-2 text-sm"
                              value={equiposSeleccionados[equipo.id_equipo]}
                              onChange={(e) => setEquiposSeleccionados((actuales) => ({ ...actuales, [equipo.id_equipo]: e.target.value }))}
                              placeholder="Estado de salida"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mb-5 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Fecha</label>
                  <input className="input" type="date" value={fechaHoy} readOnly />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Hora de inicio</label>
                  <input className="input" type="time" value={quickHoraInicio} readOnly />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Duración</label>
                  <select className="input" value={quickDuracion} onChange={(e) => setQuickDuracion(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].filter((duracion) => Number(quickHoraInicio.slice(0, 2)) + duracion <= 22).map((duracion) => (
                      <option key={duracion} value={duracion}>{duracion} {duracion === 1 ? 'hora' : 'horas'}</option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="mb-1 block text-xs font-medium text-gray-500">Observaciones de entrega</label>
              <textarea
                className="input min-h-20"
                value={quickObs}
                onChange={(e) => setQuickObs(e.target.value)}
                placeholder="Notas del préstamo en mostrador…"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
              <button type="button" onClick={() => setQuickOpen(false)} className="btn-ghost">Cancelar</button>
              <button type="button" onClick={crearPrestamoRapido} disabled={quickSaving} className="btn-primary">
                {quickSaving ? 'Creando…' : 'Confirmar y entregar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de entrega / recepción */}
      {edit && (() => {
        const p = [...prestamos, ...prestamosFecha].find((x) => x.id_prestamo === edit.id_prestamo);
        if (!p) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
            <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-card dark:bg-gray-950 sm:rounded-2xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                  {edit.tipo === 'entregar' ? (
                    <>
                      <PackageCheck size={18} className="text-brand-600" /> Entregar equipos
                    </>
                  ) : (
                    <>
                      <PackageX size={18} className="text-brand-600" /> Recibir equipos
                    </>
                  )}
                </h3>
                <button
                  type="button"
                  onClick={() => setEdit(null)}
                  className="btn-ghost h-9 w-9 !px-0"
                >
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <p className="mb-3 text-sm text-gray-500">
                  {edit.tipo === 'entregar'
                    ? 'Registrá el estado físico de salida de cada equipo.'
                    : 'Registrá el estado físico de devolución de cada equipo.'}
                </p>
                <ul className="space-y-3">
                  {(p.detalle_prestamos ?? []).map((d) => (
                    <li
                      key={d.id_detalle}
                        className={`rounded-lg border p-3 transition-colors ${
                          edit.tipo === 'recibir' && aMantenimiento[d.id_detalle]
                            ? 'border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20'
                            : 'border-gray-200 dark:border-gray-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              {d.equipos?.codigo_inventario} · {d.equipos?.categorias_equipo?.nombre}
                            </p>
                            <p className="mb-2 text-xs text-gray-500">{d.equipos?.marca_modelo ?? '—'}</p>
                          </div>
                          {edit.tipo === 'recibir' && (
                            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                              <input
                                type="checkbox"
                                checked={Boolean(aMantenimiento[d.id_detalle])}
                                onChange={(e) =>
                                  setAMantenimiento((s) => ({
                                    ...s,
                                    [d.id_detalle]: e.target.checked,
                                  }))
                                }
                                className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                              />
                              Con daño
                            </label>
                          )}
                        </div>
                        {edit.tipo === 'recibir' && aMantenimiento[d.id_detalle] && (
                          <p className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                            Pasará a «En mantenimiento»
                          </p>
                        )}
                        <input
                          className="input"
                          placeholder={
                            edit.tipo === 'entregar'
                              ? 'Ej: Buen estado, pantalla limpia'
                              : aMantenimiento[d.id_detalle]
                                ? 'Detallar daño: rotura de pantalla, cable cortado, etc.'
                                : 'Ej: Funcionando correctamente, sin daños'
                          }
                          value={estados[d.id_detalle] ?? ''}
                          onChange={(e) =>
                            setEstados((s) => ({ ...s, [d.id_detalle]: e.target.value }))
                          }
                        />
                      </li>
                  ))}
                </ul>
                <label className="mb-1 mt-4 block text-xs font-medium text-gray-500">
                  Observaciones generales
                </label>
                <textarea
                  className="input min-h-20"
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  placeholder="Notas del administrador…"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
                <button type="button" onClick={() => setEdit(null)} className="btn-ghost">
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy === p.id_prestamo}
                  onClick={guardar}
                  className="btn-primary"
                >
                  {busy === p.id_prestamo ? 'Guardando…' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function PrestamoCard({
  p,
  busy,
  onEntregar,
  onRecibir,
  showUser = false,
}: {
  p: PrestamoAdmin;
  busy: boolean;
  onEntregar: (p: PrestamoAdmin) => void;
  onRecibir: (p: PrestamoAdmin) => void;
  showUser?: boolean;
}) {
  const fecha = useMemo(
    () => new Date(p.fecha_prestamo + 'T00:00:00').toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
    [p.fecha_prestamo],
  );

  const estilosEstado: Record<string, string> = {
    Reservado: 'border-l-4 border-amber-500 bg-amber-50/30 dark:bg-amber-950/10',
    'En Curso': 'border-l-4 border-blue-600 bg-blue-50/30 dark:bg-blue-950/10',
    Devuelto: 'border-l-4 border-emerald-500 opacity-80',
    Cancelado: 'border-l-4 border-gray-400 opacity-60',
  };
  const estiloEstado = estilosEstado[p.estado] ?? 'border-l-4 border-gray-300';

  return (
    <div className={`card p-4 ${estiloEstado}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant={estadoPrestamoVariant(p.estado)}>{p.estado}</Badge>
            <span className="text-xs text-gray-500">
              {fecha} · {p.estado === 'En Curso'
                ? `Retiro ${formatoHora(p.hora_retiro_real)} · Límite ${p.hora_fin_prevista.slice(0, 5)}`
                : p.estado === 'Devuelto'
                  ? `Devuelto ${formatoHora(p.hora_devolucion_real)}`
                  : `Inicio ${p.hora_inicio_prevista.slice(0, 5)} · Fin ${p.hora_fin_prevista.slice(0, 5)}`}
            </span>
          </div>
          {showUser && p.usuarios && (
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {p.usuarios.nombre} {p.usuarios.apellido} · DNI {p.usuarios.dni}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {p.estado === 'Reservado' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onEntregar(p)}
              className="btn-primary"
            >
              <PackageCheck size={15} /> Entregar
            </button>
          )}
          {p.estado === 'En Curso' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRecibir(p)}
              className="btn-secondary"
            >
              <PackageX size={15} /> Recibir devolución
            </button>
          )}
        </div>
      </div>
      {p.detalle_prestamos && p.detalle_prestamos.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
          <ul className="grid gap-2 sm:grid-cols-2">
            {p.detalle_prestamos.map((d) => (
              <li key={d.id_detalle} className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-800">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {d.equipos?.codigo_inventario}
                </p>
                <p className="text-xs text-gray-500">
                  {d.equipos?.categorias_equipo?.nombre} · {d.equipos?.marca_modelo ?? '—'}
                </p>
                {d.estado_salida && (
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Salida: {d.estado_salida}</p>
                )}
                {d.estado_devolucion && (
                  <p className="text-xs text-gray-600 dark:text-gray-400">Devolución: {d.estado_devolucion}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
