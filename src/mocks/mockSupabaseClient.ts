import { fechaLocalISO, horaLocalHHMMSS } from '@/utils/fechas';
import type { ConfiguracionHorarios, Equipo, Rol, Usuario } from '@/types/database';
import {
  SEED_CATEGORIAS,
  SEED_CONFIGURACION_HORARIOS,
  SEED_DETALLE_PRESTAMOS,
  SEED_EQUIPOS,
  SEED_PRESTAMOS,
  SEED_ROLES,
  SEED_USUARIOS,
  SEED_USUARIO_ROLES,
} from '@/mocks/seedData';

function getLocalTable<T>(name: string, fallback: T[]): T[] {
  if (typeof window === 'undefined') return fallback;
  const key = `itu_db_${name}`;
  const stored = localStorage.getItem(key);
  if (!stored) {
    localStorage.setItem(key, JSON.stringify(fallback));
    return fallback;
  }
  try {
    const parsed = JSON.parse(stored) as T[];
    if (name === 'roles' && Array.isArray(parsed)) {
      const hasLegacy = parsed.some((r: any) => r?.id_rol === 'rol-4' || r?.nombre === 'Pañol');
      if (hasLegacy) {
        const cleaned = parsed
          .filter((r: any) => r?.id_rol !== 'rol-4' && r?.nombre !== 'Pañol')
          .map((r: any) =>
            r?.id_rol === 'rol-3' ? { ...r, descripcion: 'Personal administrativo y gestión del pañol' } : r,
          );
        localStorage.setItem(key, JSON.stringify(cleaned));
        return cleaned as T[];
      }
    }
    if (name === 'usuario_roles' && Array.isArray(parsed)) {
      const hasLegacy = parsed.some((ur: any) => ur?.id_rol === 'rol-4');
      if (hasLegacy) {
        const seen = new Set<string>();
        const cleaned = parsed
          .map((ur: any) => (ur?.id_rol === 'rol-4' ? { ...ur, id_rol: 'rol-3' } : ur))
          .filter((ur: any) => {
            const k = `${ur?.id_usuario}:${ur?.id_rol}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        localStorage.setItem(key, JSON.stringify(cleaned));
        return cleaned as T[];
      }
    }
    if (name === 'equipos' && Array.isArray(parsed)) {
      const tieneLegacy = parsed.some((e: any) =>
        ['NB-001', 'NB-002', 'NB-003'].includes(e?.codigo_inventario),
      );
      const falta10778 = !parsed.some((e: any) => e?.codigo_inventario === '10778');
      if (tieneLegacy || falta10778) {
        const sinLegacy = parsed.filter(
          (e: any) => !['NB-001', 'NB-002', 'NB-003'].includes(e?.codigo_inventario),
        );
        const codigosExistentes = new Set(
          sinLegacy.map((e: any) => String(e?.codigo_inventario ?? '')),
        );
        const notebooksNuevas = SEED_EQUIPOS.filter(
          (e) => e.id_categoria === 'cat-1' && !codigosExistentes.has(e.codigo_inventario),
        );
        const migrated = [...notebooksNuevas, ...sinLegacy];
        localStorage.setItem(key, JSON.stringify(migrated));
        return migrated as T[];
      }
    }
    if (name === 'detalle_prestamos' && Array.isArray(parsed)) {
      const tieneLegacy = parsed.some((d: any) => ['eq-1', 'eq-2', 'eq-3'].includes(d?.id_equipo));
      if (tieneLegacy) {
        const migrated = parsed.map((d: any) =>
          ['eq-1', 'eq-2', 'eq-3'].includes(d?.id_equipo) ? { ...d, id_equipo: 'eq-nb-10778' } : d,
        );
        localStorage.setItem(key, JSON.stringify(migrated));
        return migrated as T[];
      }
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function setLocalTable<T>(name: string, data: T[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`itu_db_${name}`, JSON.stringify(data));
}

export function createMockClient() {
  return {
    rpc(fn: string, params?: any): Promise<{ data: any; error: any }> {
      const users = getLocalTable('usuarios', SEED_USUARIOS);
      const roles = getLocalTable('roles', SEED_ROLES);
      const userRoles = getLocalTable('usuario_roles', SEED_USUARIO_ROLES);

      if (fn === 'iniciar_sesion') {
        const { p_dni, p_password } = params || {};
        const u = users.find((user) => user.dni === String(p_dni).trim());
        if (!u) {
          return Promise.resolve({ data: null, error: { message: 'DNI o contraseña incorrectos' } });
        }
        if (u.password_hash !== p_password && !u.password_hash.startsWith('$2')) {
          return Promise.resolve({ data: null, error: { message: 'DNI o contraseña incorrectos' } });
        }
        if (u.estado === 'Inactivo') {
          return Promise.resolve({ data: null, error: { message: 'Usuario inactivo' } });
        }

        const myRoles = userRoles
          .filter((ur) => ur.id_usuario === u.id_usuario)
          .map((ur) => roles.find((r) => r.id_rol === ur.id_rol))
          .filter((r): r is Rol => Boolean(r));

        const token = `token-${u.id_usuario}-${Date.now()}`;
        const sessionData = {
          token,
          usuario: {
            id_usuario: u.id_usuario,
            dni: u.dni,
            nombre: u.nombre,
            apellido: u.apellido,
            email: u.email,
            telefono: u.telefono,
            curso: u.curso ?? null,
            estado: u.estado,
            debe_cambiar_password: Boolean(u.debe_cambiar_password),
            fecha_baja_programada: u.fecha_baja_programada ?? null,
            motivo_baja: u.motivo_baja ?? null,
          },
          roles: myRoles,
        };
        const sesiones = getLocalTable<any>('sesiones_usuario', []);
        sesiones.push(sessionData);
        setLocalTable('sesiones_usuario', sesiones);

        return Promise.resolve({ data: sessionData, error: null });
      }

      if (fn === 'restaurar_sesion') {
        const { p_token } = params || {};
        const sesiones: any[] = getLocalTable('sesiones_usuario', []);
        const found = sesiones.find((s) => s.token === p_token);
        if (!found) {
          if (p_token && p_token.includes('u-')) {
            const userId = p_token.split('-')[1];
            const u = users.find((x) => x.id_usuario === `u-${userId}` || x.id_usuario === userId);
            if (u && u.estado !== 'Inactivo') {
              const myRoles = userRoles
                .filter((ur) => ur.id_usuario === u.id_usuario)
                .map((ur) => roles.find((r) => r.id_rol === ur.id_rol))
                .filter((r): r is Rol => Boolean(r));
              return Promise.resolve({
                data: {
                  token: p_token,
                  usuario: {
                    id_usuario: u.id_usuario,
                    dni: u.dni,
                    nombre: u.nombre,
                    apellido: u.apellido,
                    email: u.email,
                    telefono: u.telefono,
                    curso: u.curso ?? null,
                    estado: u.estado,
                    debe_cambiar_password: Boolean(u.debe_cambiar_password),
                    fecha_baja_programada: u.fecha_baja_programada ?? null,
                    motivo_baja: u.motivo_baja ?? null,
                  },
                  roles: myRoles,
                },
                error: null,
              });
            }
          }
          return Promise.resolve({ data: null, error: null });
        }
        const usuarioActual = users.find((x) => x.id_usuario === found.usuario?.id_usuario);
        if (usuarioActual?.estado === 'Inactivo') {
          return Promise.resolve({ data: null, error: null });
        }
        const currentRoles = userRoles
          .filter((ur) => ur.id_usuario === found.usuario?.id_usuario)
          .map((ur) => roles.find((r) => r.id_rol === ur.id_rol))
          .filter((r): r is Rol => Boolean(r));
        const usuarioDatos = usuarioActual
          ? {
              id_usuario: usuarioActual.id_usuario,
              dni: usuarioActual.dni,
              nombre: usuarioActual.nombre,
              apellido: usuarioActual.apellido,
              email: usuarioActual.email,
              telefono: usuarioActual.telefono,
              curso: usuarioActual.curso ?? null,
              estado: usuarioActual.estado,
              debe_cambiar_password: Boolean(usuarioActual.debe_cambiar_password),
              fecha_baja_programada: usuarioActual.fecha_baja_programada ?? null,
              motivo_baja: usuarioActual.motivo_baja ?? null,
            }
          : found.usuario;
        return Promise.resolve({
          data: {
            ...found,
            usuario: usuarioDatos,
            roles: currentRoles.length > 0 ? currentRoles : found.roles,
          },
          error: null,
        });
      }

      if (fn === 'cerrar_sesion') {
        const { p_token } = params || {};
        const sesiones: any[] = getLocalTable('sesiones_usuario', []);
        setLocalTable('sesiones_usuario', sesiones.filter((s) => s.token !== p_token));
        return Promise.resolve({ data: true, error: null });
      }

      if (fn === 'cambiar_mi_password') {
        const { p_token, p_password_actual, p_password_nueva } = params || {};
        const sesiones: any[] = getLocalTable('sesiones_usuario', []);
        const sesionActual = sesiones.find((s) => s.token === p_token);
        const u = sesionActual
          ? users.find((x) => x.id_usuario === sesionActual.usuario?.id_usuario && x.estado !== 'Inactivo')
          : null;
        if (!u) {
          return Promise.resolve({ data: null, error: { message: 'Tu sesión expiró; iniciá sesión nuevamente' } });
        }
        const actual = String(p_password_actual ?? '');
        const nueva = String(p_password_nueva ?? '');
        if (u.password_hash !== actual && !u.password_hash.startsWith('$2')) {
          return Promise.resolve({ data: null, error: { message: 'La contraseña actual es incorrecta' } });
        }
        if (nueva.length < 6) {
          return Promise.resolve({
            data: null,
            error: { message: 'La nueva contraseña debe tener al menos 6 caracteres' },
          });
        }
        if (nueva.trim() === u.dni.trim()) {
          return Promise.resolve({
            data: null,
            error: { message: 'La nueva contraseña no puede ser igual a tu DNI' },
          });
        }
        if (nueva === actual) {
          return Promise.resolve({
            data: null,
            error: { message: 'Elegí una contraseña diferente a la actual' },
          });
        }

        const updatedUsers = users.map((item) =>
          item.id_usuario === u.id_usuario
            ? { ...item, password_hash: nueva, debe_cambiar_password: false }
            : item,
        );
        setLocalTable('usuarios', updatedUsers);

        const myRoles = userRoles
          .filter((ur) => ur.id_usuario === u.id_usuario)
          .map((ur) => roles.find((r) => r.id_rol === ur.id_rol))
          .filter((r): r is Rol => Boolean(r));

        const usuarioPublico = {
          id_usuario: u.id_usuario,
          dni: u.dni,
          nombre: u.nombre,
          apellido: u.apellido,
          email: u.email,
          telefono: u.telefono,
          curso: u.curso ?? null,
          estado: u.estado,
          debe_cambiar_password: false,
          fecha_baja_programada: u.fecha_baja_programada ?? null,
          motivo_baja: u.motivo_baja ?? null,
        };

        const updatedSesiones = sesiones.map((s) =>
          s.usuario?.id_usuario === u.id_usuario ? { ...s, usuario: usuarioPublico, roles: myRoles } : s,
        );
        setLocalTable('sesiones_usuario', updatedSesiones);

        return Promise.resolve({
          data: { token: p_token, usuario: usuarioPublico, roles: myRoles },
          error: null,
        });
      }

      if (fn === 'admin_restablecer_password_usuario') {
        const { p_token, p_id_usuario, p_password_nueva } = params || {};
        const sesiones: any[] = getLocalTable('sesiones_usuario', []);
        const sesionAdmin = sesiones.find((s) => s.token === p_token);
        if (sesionAdmin && sesionAdmin.usuario?.id_usuario === p_id_usuario) {
          return Promise.resolve({
            data: null,
            error: { message: 'Para cambiar tu propia contraseña usá el botón "Cambiar contraseña" en el encabezado' },
          });
        }
        const target = users.find((u) => u.id_usuario === p_id_usuario);
        if (!target) {
          return Promise.resolve({ data: null, error: { message: 'El usuario no existe' } });
        }
        const nueva = String(p_password_nueva ?? '').trim() || target.dni.trim();
        if (nueva.length < 6) {
          return Promise.resolve({
            data: null,
            error: { message: 'La contraseña debe tener al menos 6 caracteres' },
          });
        }
        const updatedUsers = users.map((u) =>
          u.id_usuario === p_id_usuario ? { ...u, password_hash: nueva, debe_cambiar_password: true } : u,
        );
        setLocalTable('usuarios', updatedUsers);
        setLocalTable(
          'sesiones_usuario',
          sesiones.filter((s) => s.usuario?.id_usuario !== p_id_usuario),
        );
        return Promise.resolve({ data: null, error: null });
      }

      if (fn === 'actualizar_limite_categoria') {
        const { p_id_categoria, p_limite } = params || {};
        const cats = getLocalTable('categorias_equipo', SEED_CATEGORIAS);
        const updated = cats.map((c) => (c.id_categoria === p_id_categoria ? { ...c, limite_alumnos: p_limite } : c));
        setLocalTable('categorias_equipo', updated);
        return Promise.resolve({ data: true, error: null });
      }

      if (fn === 'cancelar_reservas_vencidas') {
        const prestamos = getLocalTable('prestamos', SEED_PRESTAMOS);
        const equipos = getLocalTable('equipos', SEED_EQUIPOS);
        const detalles = getLocalTable('detalle_prestamos', SEED_DETALLE_PRESTAMOS);
        const cfg = getLocalTable('configuracion_horarios', SEED_CONFIGURACION_HORARIOS)[0] ?? SEED_CONFIGURACION_HORARIOS[0];
        const toleranciaMin = typeof cfg.tolerancia_retiro_min === 'number' ? cfg.tolerancia_retiro_min : 5;
        const hoy = fechaLocalISO();
        const horaActual = horaLocalHHMMSS();
        const [ah, am] = horaActual.slice(0, 5).split(':').map(Number);
        const ahoraMin = ah * 60 + am;
        let canceladas = 0;

        const vencidosIds = new Set<string>();
        const updated = prestamos.map((p) => {
          let vencido = false;
          if (p.estado === 'Reservado') {
            if (p.fecha_prestamo < hoy) {
              vencido = true;
            } else if (p.fecha_prestamo === hoy) {
              if (p.retiro_hasta) {
                const [rh, rm] = p.retiro_hasta.slice(0, 5).split(':').map(Number);
                vencido = rh * 60 + rm + toleranciaMin < ahoraMin;
              } else {
                vencido = p.hora_fin_prevista < horaActual;
              }
            }
          }
          if (vencido) {
            canceladas++;
            vencidosIds.add(p.id_prestamo);
            return { ...p, estado: 'No Presentado' as const };
          }
          return p;
        });

        if (canceladas > 0) {
          const eqIdsLiberar = new Set(
            detalles.filter((d) => vencidosIds.has(d.id_prestamo)).map((d) => d.id_equipo),
          );
          const eqConOtraReservaActiva = new Set(
            detalles
              .filter((d) => {
                if (vencidosIds.has(d.id_prestamo)) return false;
                const p2 = updated.find((p) => p.id_prestamo === d.id_prestamo);
                return p2 && (p2.estado === 'Reservado' || p2.estado === 'En Curso');
              })
              .map((d) => d.id_equipo),
          );
          equipos.forEach((e) => {
            if (eqIdsLiberar.has(e.id_equipo) && !eqConOtraReservaActiva.has(e.id_equipo) && e.estado === 'Reservado') {
              e.estado = 'Disponible';
            }
          });
          setLocalTable('prestamos', updated);
          setLocalTable('equipos', equipos);
        }

        return Promise.resolve({ data: canceladas, error: null });
      }

      if (fn === 'admin_listar_usuarios') {
        const list = users
          .map((u) => {
            const myRoles = userRoles
              .filter((ur) => ur.id_usuario === u.id_usuario)
              .map((ur) => roles.find((r) => r.id_rol === ur.id_rol))
              .filter((r): r is Rol => Boolean(r))
              .sort((a, b) => a.nombre.localeCompare(b.nombre));
            return {
              id_usuario: u.id_usuario,
              dni: u.dni,
              nombre: u.nombre,
              apellido: u.apellido,
              email: u.email,
              telefono: u.telefono,
              curso: u.curso ?? null,
              estado: u.estado,
              debe_cambiar_password: Boolean(u.debe_cambiar_password),
              fecha_baja_programada: u.fecha_baja_programada ?? null,
              motivo_baja: u.motivo_baja ?? null,
              roles: myRoles,
            };
          })
          .sort((a, b) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`));
        return Promise.resolve({ data: list, error: null });
      }

      if (fn === 'admin_crear_usuario') {
        const { p_dni, p_nombre, p_apellido, p_email, p_telefono, p_curso, p_password, p_estado, p_roles } =
          params || {};
        const dni = String(p_dni ?? '').trim();
        const email = String(p_email ?? '').trim().toLowerCase();
        if (!dni || !String(p_nombre ?? '').trim() || !String(p_apellido ?? '').trim()) {
          return Promise.resolve({ data: null, error: { message: 'DNI, nombre y apellido son obligatorios' } });
        }
        if (!email) {
          return Promise.resolve({ data: null, error: { message: 'El correo electrónico es obligatorio' } });
        }
        if (String(p_password ?? '').length < 6) {
          return Promise.resolve({
            data: null,
            error: { message: 'La contraseña inicial debe tener al menos 6 caracteres' },
          });
        }
        if (!Array.isArray(p_roles) || p_roles.length === 0) {
          return Promise.resolve({ data: null, error: { message: 'Debés asignar al menos un rol al usuario' } });
        }
        if (users.some((u) => u.dni === dni)) {
          return Promise.resolve({ data: null, error: { message: 'Ya existe un usuario con ese DNI' } });
        }
        if (users.some((u) => u.email.toLowerCase() === email)) {
          return Promise.resolve({ data: null, error: { message: 'Ya existe un usuario con ese correo' } });
        }
        const cursoLimpio = String(p_curso ?? '').trim() || null;
        if (cursoLimpio !== null && !['1°', '2°', '3°', 'Egresado'].includes(cursoLimpio)) {
          return Promise.resolve({ data: null, error: { message: 'El curso debe ser 1°, 2°, 3° o Egresado' } });
        }
        const id_usuario = `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const passwordLimpia = String(p_password ?? '');
        const nuevo = {
          id_usuario,
          dni,
          nombre: String(p_nombre).trim(),
          apellido: String(p_apellido).trim(),
          email,
          telefono: String(p_telefono ?? '').trim() || null,
          curso: cursoLimpio,
          password_hash: passwordLimpia,
          estado: (p_estado || 'Activo') as Usuario['estado'],
          debe_cambiar_password: passwordLimpia.trim() === dni,
          fecha_baja_programada: null,
          motivo_baja: null,
        };
        setLocalTable('usuarios', [...users, nuevo]);
        const nuevosRoles = [...userRoles, ...p_roles.map((id_rol: string) => ({ id_usuario, id_rol }))];
        setLocalTable('usuario_roles', nuevosRoles);
        return Promise.resolve({ data: id_usuario, error: null });
      }

      if (fn === 'admin_actualizar_usuario') {
        const { p_id_usuario, p_dni, p_nombre, p_apellido, p_email, p_telefono, p_curso, p_estado, p_roles } =
          params || {};
        if (!Array.isArray(p_roles) || p_roles.length === 0) {
          return Promise.resolve({ data: null, error: { message: 'El usuario debe tener al menos un rol asignado' } });
        }
        const dni = String(p_dni ?? '').trim();
        const email = String(p_email ?? '').trim().toLowerCase();
        if (users.some((u) => u.id_usuario !== p_id_usuario && u.dni === dni)) {
          return Promise.resolve({ data: null, error: { message: 'Ya existe otro usuario con ese DNI' } });
        }
        if (users.some((u) => u.id_usuario !== p_id_usuario && u.email.toLowerCase() === email)) {
          return Promise.resolve({ data: null, error: { message: 'Ya existe otro usuario con ese correo' } });
        }
        const cursoLimpio = String(p_curso ?? '').trim() || null;
        if (cursoLimpio !== null && !['1°', '2°', '3°', 'Egresado'].includes(cursoLimpio)) {
          return Promise.resolve({ data: null, error: { message: 'El curso debe ser 1°, 2°, 3° o Egresado' } });
        }
        const updated = users.map((u) =>
          u.id_usuario === p_id_usuario
            ? {
                ...u,
                dni,
                nombre: String(p_nombre).trim(),
                apellido: String(p_apellido).trim(),
                email,
                telefono: String(p_telefono ?? '').trim() || null,
                curso: cursoLimpio,
                estado: p_estado,
                fecha_baja_programada: p_estado === 'Activo' ? null : (u.fecha_baja_programada ?? null),
                motivo_baja: p_estado === 'Activo' ? null : (u.motivo_baja ?? null),
              }
            : u,
        );
        setLocalTable('usuarios', updated);
        const filteredRoles = userRoles.filter((ur) => ur.id_usuario !== p_id_usuario);
        setLocalTable('usuario_roles', [
          ...filteredRoles,
          ...p_roles.map((id_rol: string) => ({ id_usuario: p_id_usuario, id_rol })),
        ]);
        return Promise.resolve({ data: null, error: null });
      }

      if (fn === 'admin_programar_baja_usuario') {
        const { p_id_usuario, p_dias, p_motivo } = params || {};
        const prestamos = getLocalTable('prestamos', SEED_PRESTAMOS);
        const tieneActivos = prestamos.some(
          (p) => p.id_usuario === p_id_usuario && (p.estado === 'Reservado' || p.estado === 'En Curso'),
        );
        if (p_dias === 0) {
          if (tieneActivos) {
            return Promise.resolve({
              data: null,
              error: {
                message: 'El usuario tiene préstamos o reservas activas; debe devolver los equipos antes de eliminarlo',
              },
            });
          }
          setLocalTable('usuarios', users.filter((u) => u.id_usuario !== p_id_usuario));
          setLocalTable('usuario_roles', userRoles.filter((ur) => ur.id_usuario !== p_id_usuario));
          return Promise.resolve({ data: 'eliminado', error: null });
        }
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + Number(p_dias || 30));
        const fechaBaja = fechaLocalISO(targetDate);
        const updated = users.map((u) =>
          u.id_usuario === p_id_usuario
            ? {
                ...u,
                estado: 'Inactivo' as const,
                fecha_baja_programada: fechaBaja,
                motivo_baja: String(p_motivo ?? '').trim() || 'Egreso / Baja programada',
              }
            : u,
        );
        setLocalTable('usuarios', updated);
        return Promise.resolve({ data: 'programado', error: null });
      }

      if (fn === 'admin_cancelar_baja_usuario') {
        const { p_id_usuario } = params || {};
        const updated = users.map((u) =>
          u.id_usuario === p_id_usuario
            ? { ...u, estado: 'Activo' as const, fecha_baja_programada: null, motivo_baja: null }
            : u,
        );
        setLocalTable('usuarios', updated);
        return Promise.resolve({ data: null, error: null });
      }

      if (fn === 'admin_depurar_bajas_vencidas') {
        const hoy = fechaLocalISO();
        const prestamos = getLocalTable('prestamos', SEED_PRESTAMOS);
        const conActivos = new Set(
          prestamos
            .filter((p) => p.estado === 'Reservado' || p.estado === 'En Curso')
            .map((p) => p.id_usuario),
        );
        const aEliminar = new Set(
          users
            .filter((u) => u.fecha_baja_programada && u.fecha_baja_programada <= hoy && !conActivos.has(u.id_usuario))
            .map((u) => u.id_usuario),
        );
        if (aEliminar.size > 0) {
          setLocalTable('usuarios', users.filter((u) => !aEliminar.has(u.id_usuario)));
          setLocalTable('usuario_roles', userRoles.filter((ur) => !aEliminar.has(ur.id_usuario)));
        }
        return Promise.resolve({ data: aEliminar.size, error: null });
      }

      if (fn === 'admin_buscar_prestamo_por_codigo') {
        const { p_codigo } = params || {};
        const limpio = String(p_codigo ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (limpio.length < 4) {
          return Promise.resolve({ data: null, error: { message: 'Ingresá un código de retiro válido' } });
        }

        return createMockClient()
          .rpc('cancelar_reservas_vencidas')
          .then(() => {
            const prestamos = getLocalTable('prestamos', SEED_PRESTAMOS);
            const encontrado = prestamos.find(
              (p) => String(p.codigo_retiro ?? '').toUpperCase() === limpio,
            );
            if (!encontrado) {
              return {
                data: null,
                error: { message: `No encontramos ninguna reserva con el código ${limpio}` },
              };
            }

            const detalles = getLocalTable('detalle_prestamos', SEED_DETALLE_PRESTAMOS);
            const equipos = getLocalTable('equipos', SEED_EQUIPOS);
            const cats = getLocalTable('categorias_equipo', SEED_CATEGORIAS);
            const usuario = users.find((u) => u.id_usuario === encontrado.id_usuario);

            return {
              data: {
                ...encontrado,
                usuarios: usuario
                  ? {
                      id_usuario: usuario.id_usuario,
                      dni: usuario.dni,
                      nombre: usuario.nombre,
                      apellido: usuario.apellido,
                      estado: usuario.estado,
                    }
                  : undefined,
                detalle_prestamos: detalles
                  .filter((d) => d.id_prestamo === encontrado.id_prestamo)
                  .map((d) => {
                    const eq = equipos.find((e) => e.id_equipo === d.id_equipo);
                    const cat = eq ? cats.find((c) => c.id_categoria === eq.id_categoria) : undefined;
                    return {
                      ...d,
                      equipos: eq ? { ...eq, categorias_equipo: cat } : undefined,
                    };
                  }),
              },
              error: null,
            };
          });
      }

      if (fn === 'admin_guardar_configuracion_horarios') {
        const {
          p_franjas_activas,
          p_tolerancia_retiro_min,
          p_hora_cierre_devolucion,
          p_franjas,
          p_dias_anticipacion_max = 7,
          p_permitir_fines_de_semana = false,
        } = params || {};
        const tol = Number(p_tolerancia_retiro_min);
        if (!Number.isFinite(tol) || tol < 0 || tol > 60) {
          return Promise.resolve({
            data: null,
            error: { message: 'La tolerancia debe estar entre 0 y 60 minutos' },
          });
        }
        const diasMax = Number(p_dias_anticipacion_max);
        if (!Number.isFinite(diasMax) || diasMax < 0 || diasMax > 90) {
          return Promise.resolve({
            data: null,
            error: { message: 'Los días máximos de anticipación deben estar entre 0 y 90' },
          });
        }
        const guardado: ConfiguracionHorarios = {
          id: 1,
          franjas_activas: Boolean(p_franjas_activas),
          tolerancia_retiro_min: tol,
          hora_cierre_devolucion: String(p_hora_cierre_devolucion ?? '22:00:00'),
          dias_anticipacion_max: Math.round(diasMax),
          permitir_fines_de_semana: Boolean(p_permitir_fines_de_semana),
          franjas: Array.isArray(p_franjas) ? p_franjas : [],
        };
        setLocalTable('configuracion_horarios', [guardado]);
        return Promise.resolve({ data: guardado, error: null });
      }

      if (fn === 'admin_cambiar_equipo_prestamo') {
        const {
          p_id_prestamo,
          p_id_detalle,
          p_id_equipo_nuevo,
          p_estado_equipo_anterior = 'Disponible',
          p_motivo,
        } = params || {};

        const prestamos = getLocalTable('prestamos', SEED_PRESTAMOS);
        const detalles = getLocalTable('detalle_prestamos', SEED_DETALLE_PRESTAMOS);
        const equipos = getLocalTable('equipos', SEED_EQUIPOS);

        const prestamo = prestamos.find((p) => p.id_prestamo === p_id_prestamo);
        if (!prestamo || prestamo.estado !== 'En Curso') {
          return Promise.resolve({
            data: null,
            error: { message: 'Solo se puede cambiar equipos en préstamos En Curso' },
          });
        }

        const detalle = detalles.find(
          (d) => d.id_detalle === p_id_detalle && d.id_prestamo === p_id_prestamo,
        );
        if (!detalle) {
          return Promise.resolve({
            data: null,
            error: { message: 'El detalle de equipo no pertenece a este préstamo' },
          });
        }

        if (detalle.id_equipo === p_id_equipo_nuevo) {
          return Promise.resolve({
            data: null,
            error: { message: 'Elegí un equipo diferente al actual' },
          });
        }

        const yaEnPrestamo = detalles.some(
          (d) => d.id_prestamo === p_id_prestamo && d.id_equipo === p_id_equipo_nuevo,
        );
        if (yaEnPrestamo) {
          return Promise.resolve({
            data: null,
            error: { message: 'El equipo nuevo ya forma parte de este préstamo' },
          });
        }

        const equipoAnt = equipos.find((e) => e.id_equipo === detalle.id_equipo);
        const equipoNuevo = equipos.find((e) => e.id_equipo === p_id_equipo_nuevo);
        if (!equipoNuevo || equipoNuevo.estado !== 'Disponible') {
          return Promise.resolve({
            data: null,
            error: { message: 'El equipo nuevo ya no está Disponible' },
          });
        }

        const inicioActual = String(prestamo.hora_inicio_prevista).slice(0, 5);
        const finActual = String(prestamo.hora_fin_prevista).slice(0, 5);
        const conflicto = detalles.some((d) => {
          if (d.id_equipo !== p_id_equipo_nuevo || d.id_prestamo === p_id_prestamo) return false;
          const p2 = prestamos.find((x) => x.id_prestamo === d.id_prestamo);
          if (!p2 || p2.fecha_prestamo !== prestamo.fecha_prestamo) return false;
          if (p2.estado !== 'Reservado' && p2.estado !== 'En Curso') return false;
          const ini2 = String(p2.hora_inicio_prevista).slice(0, 5);
          const fin2 = String(p2.hora_fin_prevista).slice(0, 5);
          return inicioActual < fin2 && finActual > ini2;
        });
        if (conflicto) {
          return Promise.resolve({
            data: null,
            error: {
              message: `El equipo ${equipoNuevo.codigo_inventario} tiene una reserva superpuesta en ese horario`,
            },
          });
        }

        const motivoLimpio = String(p_motivo ?? '').trim();
        const codAnt = equipoAnt?.codigo_inventario ?? '';
        const codNuevo = equipoNuevo.codigo_inventario;

        const detallesActualizados = detalles.map((d) =>
          d.id_detalle === p_id_detalle
            ? {
                ...d,
                id_equipo: p_id_equipo_nuevo,
                estado_salida: motivoLimpio || `Cambio en mostrador (reemplaza a ${codAnt})`,
              }
            : d,
        );
        setLocalTable('detalle_prestamos', detallesActualizados);

        const equiposActualizados = equipos.map((e) => {
          if (e.id_equipo === detalle.id_equipo) {
            return {
              ...e,
              estado: p_estado_equipo_anterior as Equipo['estado'],
              observaciones:
                p_estado_equipo_anterior === 'En mantenimiento' && motivoLimpio
                  ? `${e.observaciones ? `${e.observaciones} | ` : ''}Cambio en préstamo: ${motivoLimpio}`
                  : e.observaciones,
            };
          }
          if (e.id_equipo === p_id_equipo_nuevo) {
            return { ...e, estado: 'En préstamo' as const };
          }
          return e;
        });
        setLocalTable('equipos', equiposActualizados);

        const notaCambio = `Cambio ${codAnt} -> ${codNuevo}${motivoLimpio ? ` (${motivoLimpio})` : ''}`;
        const prestamosActualizados = prestamos.map((p) =>
          p.id_prestamo === p_id_prestamo
            ? {
                ...p,
                observaciones_entrega: p.observaciones_entrega
                  ? `${p.observaciones_entrega} | ${notaCambio}`
                  : notaCambio,
              }
            : p,
        );
        setLocalTable('prestamos', prestamosActualizados);

        return Promise.resolve({
          data: { equipo_anterior: codAnt, equipo_nuevo: codNuevo },
          error: null,
        });
      }

      return Promise.resolve({ data: 0, error: null });
    },

    from(table: string) {
      let filters: ((item: any) => boolean)[] = [];
      let sortCol: string | null = null;
      let sortAsc = true;
      let limitCount: number | null = null;
      let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let mutationPayload: any = null;
      let returningSelect = false;

      const formatoCodigoRetiro = /^([A-Z][0-9]{3}|[0-9]{3}[A-Z])$/;

      const generarCodigoRetiroLocal = (existentes: any[]) => {
        const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const digitos = '23456789';
        const usados = new Set(existentes.map((p) => String(p.codigo_retiro ?? '').toUpperCase()));
        for (let intento = 0; intento < 200; intento++) {
          const letra = letras[Math.floor(Math.random() * letras.length)];
          let nums = '';
          for (let i = 0; i < 3; i++) {
            nums += digitos[Math.floor(Math.random() * digitos.length)];
          }
          const code = Math.random() < 0.5 ? `${letra}${nums}` : `${nums}${letra}`;
          if (!usados.has(code)) {
            usados.add(code);
            return code;
          }
        }
        const letraFallback = letras[Math.floor(Math.random() * letras.length)];
        const numsFallback = String(Math.floor(222 + Math.random() * 777));
        return `${letraFallback}${numsFallback}`;
      };

      const getTableData = (): any[] => {
        switch (table) {
          case 'roles':
            return getLocalTable('roles', SEED_ROLES);
          case 'categorias_equipo':
            return getLocalTable('categorias_equipo', SEED_CATEGORIAS);
          case 'usuarios':
            return getLocalTable('usuarios', SEED_USUARIOS);
          case 'usuario_roles':
            return getLocalTable('usuario_roles', SEED_USUARIO_ROLES);
          case 'equipos': {
            const lista = getLocalTable('equipos', SEED_EQUIPOS);
            if (lista.some((e) => e.estado === 'Reservado')) {
              const normalizados = lista.map((e) =>
                e.estado === 'Reservado' ? { ...e, estado: 'Disponible' as const } : e,
              );
              setLocalTable('equipos', normalizados);
              return normalizados;
            }
            return lista;
          }
          case 'prestamos': {
            const lista = getLocalTable('prestamos', SEED_PRESTAMOS);
            let huboBackfill = false;
            const conCodigos = lista.map((p) => {
              const codActual = String(p.codigo_retiro ?? '').toUpperCase();
              if (
                (p.estado === 'Reservado' || p.estado === 'En Curso') &&
                (!codActual || !formatoCodigoRetiro.test(codActual))
              ) {
                huboBackfill = true;
                const nuevoCodigo = generarCodigoRetiroLocal(lista);
                return { ...p, codigo_retiro: nuevoCodigo };
              }
              return p;
            });
            if (huboBackfill) setLocalTable('prestamos', conCodigos);
            return conCodigos;
          }
          case 'detalle_prestamos':
            return getLocalTable('detalle_prestamos', SEED_DETALLE_PRESTAMOS);
          case 'configuracion_horarios':
            return getLocalTable('configuracion_horarios', SEED_CONFIGURACION_HORARIOS);
          default:
            return getLocalTable(table, []);
        }
      };

      const saveTableData = (data: any[]) => {
        setLocalTable(table, data);
      };

      const idKeyForTable = () =>
        table === 'usuarios'
          ? 'id_usuario'
          : table === 'equipos'
            ? 'id_equipo'
            : table === 'prestamos'
              ? 'id_prestamo'
              : table === 'detalle_prestamos'
                ? 'id_detalle'
                : table === 'categorias_equipo'
                  ? 'id_categoria'
                  : 'id';

      const getField = (item: any, col: string): any => {
        if (!col.includes('.')) return item[col];
        return col.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), item);
      };

      const populateRows = (rows: any[]) => {
        const cats = getLocalTable('categorias_equipo', SEED_CATEGORIAS);
        const users = getLocalTable('usuarios', SEED_USUARIOS);
        const roles = getLocalTable('roles', SEED_ROLES);
        const userRoles = getLocalTable('usuario_roles', SEED_USUARIO_ROLES);
        const equipos = getLocalTable('equipos', SEED_EQUIPOS);
        const prestamos = getLocalTable('prestamos', SEED_PRESTAMOS);
        const detalles = getLocalTable('detalle_prestamos', SEED_DETALLE_PRESTAMOS);

        return rows.map((r) => {
          const copy = { ...r };
          if (table === 'usuarios') {
            copy.usuario_roles = userRoles
              .filter((ur) => ur.id_usuario === copy.id_usuario)
              .map((ur) => ({
                ...ur,
                roles: roles.find((rol) => rol.id_rol === ur.id_rol),
              }));
          }
          if (table === 'equipos' && copy.id_categoria) {
            copy.categorias_equipo = cats.find((c) => c.id_categoria === copy.id_categoria);
          }
          if (table === 'usuario_roles' && copy.id_rol) {
            copy.roles = roles.find((rol) => rol.id_rol === copy.id_rol);
          }
          if (table === 'prestamos') {
            if (copy.id_usuario) {
              const u = users.find((user) => user.id_usuario === copy.id_usuario);
              if (u) {
                const uRoles = userRoles
                  .filter((ur) => ur.id_usuario === u.id_usuario)
                  .map((ur) => ({
                    ...ur,
                    roles: roles.find((rol) => rol.id_rol === ur.id_rol),
                  }));
                copy.usuarios = { ...u, usuario_roles: uRoles };
              }
            }
            copy.detalle_prestamos = detalles
              .filter((d) => d.id_prestamo === copy.id_prestamo)
              .map((d) => {
                const eq = equipos.find((e) => e.id_equipo === d.id_equipo);
                const cat = eq ? cats.find((c) => c.id_categoria === eq.id_categoria) : undefined;
                return {
                  ...d,
                  equipos: eq ? { ...eq, categorias_equipo: cat } : undefined,
                };
              });
          }
          if (table === 'detalle_prestamos') {
            if (copy.id_equipo) {
              const eq = equipos.find((e) => e.id_equipo === copy.id_equipo);
              const cat = eq ? cats.find((c) => c.id_categoria === eq.id_categoria) : undefined;
              copy.equipos = eq ? { ...eq, categorias_equipo: cat } : undefined;
            }
            if (copy.id_prestamo) {
              const p = prestamos.find((pr) => pr.id_prestamo === copy.id_prestamo);
              copy.prestamos = p
                ? { ...p, usuarios: users.find((u) => u.id_usuario === p.id_usuario) }
                : undefined;
            }
          }
          return copy;
        });
      };

      const execute = async (): Promise<{ data: any; error: any; count?: number }> => {
        if (mode === 'insert') {
          const current = [...getTableData()];
          const items = Array.isArray(mutationPayload) ? mutationPayload : [mutationPayload];
          const inserted: any[] = [];
          const idKey = idKeyForTable();

          for (const item of items) {
            if (table === 'equipos') {
              const dupCodigo = current.some(
                (e) =>
                  String(e.codigo_inventario ?? '').toLowerCase() ===
                  String(item.codigo_inventario ?? '').toLowerCase(),
              );
              if (dupCodigo) {
                return {
                  data: null,
                  error: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint "equipos_codigo_inventario_key"',
                  },
                };
              }
              const serieNorm = String(item.numero_serie ?? '').trim().toUpperCase();
              if (serieNorm) {
                const dupSerie = current.some(
                  (e) => String(e.numero_serie ?? '').trim().toUpperCase() === serieNorm,
                );
                if (dupSerie) {
                  return {
                    data: null,
                    error: {
                      code: '23505',
                      message: 'duplicate key value violates unique constraint "idx_equipos_numero_serie_unico"',
                    },
                  };
                }
              }
            }
            if (table === 'detalle_prestamos') {
              const prestamosLocal = getLocalTable('prestamos', SEED_PRESTAMOS);
              const equiposLocal = getLocalTable('equipos', SEED_EQUIPOS);
              const pr = prestamosLocal.find((p) => p.id_prestamo === item.id_prestamo);
              const eq = equiposLocal.find((e) => e.id_equipo === item.id_equipo);
              if (pr?.estado === 'Reservado' && eq?.oculto_catalogo) {
                return {
                  data: null,
                  error: {
                    message: `El equipo ${eq.codigo_inventario} está oculto del catálogo y no puede reservarse por este medio`,
                  },
                };
              }
            }
            if (table === 'categorias_equipo') {
              const dup = current.some(
                (c) => String(c.nombre ?? '').toLowerCase() === String(item.nombre ?? '').toLowerCase(),
              );
              if (dup) {
                return {
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                };
              }
            }

            const newItem = {
              [idKey]:
                item[idKey] ||
                `${table}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              ...(table === 'prestamos' && !item.codigo_retiro
                ? { codigo_retiro: generarCodigoRetiroLocal(current) }
                : {}),
              ...(table === 'equipos' && item.oculto_catalogo === undefined
                ? { oculto_catalogo: false }
                : {}),
              ...item,
            };
            current.push(newItem);
            inserted.push(newItem);
          }

          saveTableData(current);
          const resultData = returningSelect
            ? populateRows(inserted)
            : Array.isArray(mutationPayload)
              ? inserted
              : inserted[0];
          return { data: resultData, error: null };
        }

        if (mode === 'update') {
          const current = getTableData();
          let count = 0;
          const cancelledLoanIds = new Set<string>();
          const matchedUpdated: any[] = [];

          if (table === 'equipos') {
            const targetIds = new Set(
              current.filter((item) => filters.every((f) => f(item))).map((item) => item.id_equipo),
            );
            if (mutationPayload?.codigo_inventario !== undefined) {
              const dupCodigo = current.some(
                (e) =>
                  !targetIds.has(e.id_equipo) &&
                  String(e.codigo_inventario ?? '').toLowerCase() ===
                    String(mutationPayload.codigo_inventario ?? '').toLowerCase(),
              );
              if (dupCodigo) {
                return {
                  data: null,
                  error: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint "equipos_codigo_inventario_key"',
                  },
                };
              }
            }
            if (mutationPayload?.numero_serie !== undefined) {
              const serieNorm = String(mutationPayload.numero_serie ?? '').trim().toUpperCase();
              if (serieNorm) {
                const dupSerie = current.some(
                  (e) =>
                    !targetIds.has(e.id_equipo) &&
                    String(e.numero_serie ?? '').trim().toUpperCase() === serieNorm,
                );
                if (dupSerie) {
                  return {
                    data: null,
                    error: {
                      code: '23505',
                      message: 'duplicate key value violates unique constraint "idx_equipos_numero_serie_unico"',
                    },
                  };
                }
              }
            }
          }

          const updated = current.map((item) => {
            const matches = filters.every((f) => f(item));
            if (matches) {
              count++;
              const nextItem = { ...item, ...mutationPayload };
              if (
                table === 'prestamos' &&
                (nextItem.estado === 'Cancelado' || nextItem.estado === 'No Presentado') &&
                (item.estado === 'Reservado' || item.estado === 'En Curso')
              ) {
                cancelledLoanIds.add(item.id_prestamo);
              }
              matchedUpdated.push(nextItem);
              return nextItem;
            }
            return item;
          });
          saveTableData(updated);

          if (table === 'prestamos' && cancelledLoanIds.size > 0) {
            const equipos = getLocalTable('equipos', SEED_EQUIPOS);
            const detalles = getLocalTable('detalle_prestamos', SEED_DETALLE_PRESTAMOS);
            const eqIdsLiberar = new Set(
              detalles.filter((d) => cancelledLoanIds.has(d.id_prestamo)).map((d) => d.id_equipo),
            );
            const eqConOtroEnCurso = new Set(
              detalles
                .filter((d) => {
                  if (cancelledLoanIds.has(d.id_prestamo)) return false;
                  const p2 = updated.find((p) => p.id_prestamo === d.id_prestamo);
                  return p2 && p2.estado === 'En Curso';
                })
                .map((d) => d.id_equipo),
            );
            equipos.forEach((e) => {
              if (
                eqIdsLiberar.has(e.id_equipo) &&
                (e.estado === 'Reservado' || (e.estado === 'En préstamo' && !eqConOtroEnCurso.has(e.id_equipo)))
              ) {
                e.estado = 'Disponible';
              }
            });
            setLocalTable('equipos', equipos);
          }

          return {
            data: returningSelect ? populateRows(matchedUpdated) : matchedUpdated,
            error: null,
            count,
          };
        }

        if (mode === 'delete') {
          const current = getTableData();
          const toDelete = current.filter((item) => filters.every((f) => f(item)));

          if (table === 'equipos' && toDelete.length > 0) {
            const detalles = getLocalTable('detalle_prestamos', SEED_DETALLE_PRESTAMOS);
            const idsEliminar = new Set(toDelete.map((e) => e.id_equipo));
            if (detalles.some((d) => idsEliminar.has(d.id_equipo))) {
              return {
                data: null,
                error: { code: '23503', message: 'violates foreign key constraint' },
              };
            }
          }

          const remaining = current.filter((item) => !filters.every((f) => f(item)));
          saveTableData(remaining);
          return {
            data: returningSelect ? populateRows(toDelete) : null,
            error: null,
          };
        }

        // mode === 'select'
        let rows = populateRows([...getTableData()]);
        for (const f of filters) {
          rows = rows.filter(f);
        }

        if (sortCol) {
          rows.sort((a, b) => {
            const va = getField(a, sortCol!);
            const vb = getField(b, sortCol!);
            if (va == null && vb == null) return 0;
            if (va == null) return sortAsc ? 1 : -1;
            if (vb == null) return sortAsc ? -1 : 1;
            return sortAsc
              ? String(va).localeCompare(String(vb))
              : String(vb).localeCompare(String(va));
          });
        }

        if (limitCount != null) {
          rows = rows.slice(0, limitCount);
        }

        return { data: rows, error: null };
      };

      const builder: any = {
        select(columns = '*') {
          builder._columns = columns;
          if (mode !== 'select') {
            returningSelect = true;
          }
          return builder;
        },
        insert(values: any | any[]) {
          mode = 'insert';
          mutationPayload = values;
          return builder;
        },
        update(values: any) {
          mode = 'update';
          mutationPayload = values;
          return builder;
        },
        delete() {
          mode = 'delete';
          return builder;
        },
        eq(col: string, val: any) {
          filters.push((item) => String(getField(item, col)) === String(val));
          return builder;
        },
        neq(col: string, val: any) {
          filters.push((item) => String(getField(item, col)) !== String(val));
          return builder;
        },
        not(col: string, operator: string, val: any) {
          if (operator === 'is' && val === null) {
            filters.push((item) => getField(item, col) !== null && getField(item, col) !== undefined);
          } else {
            filters.push((item) => getField(item, col) !== val);
          }
          return builder;
        },
        in(col: string, arr: any[]) {
          const stringArr = (arr || []).map((x) => String(x));
          filters.push((item) => stringArr.includes(String(getField(item, col))));
          return builder;
        },
        gte(col: string, val: any) {
          filters.push((item) => getField(item, col) >= val);
          return builder;
        },
        lte(col: string, val: any) {
          filters.push((item) => getField(item, col) <= val);
          return builder;
        },
        or(expression: string) {
          const clauses = expression.split(',').map((c) => c.trim());
          filters.push((item) =>
            clauses.some((clause) => {
              const ilikeMatch = clause.match(/^([^.]+)\.ilike\.%(.*)%$/);
              if (ilikeMatch) {
                const [, col, term] = ilikeMatch;
                return String(item[col] ?? '').toLowerCase().includes(term.toLowerCase());
              }
              const eqMatch = clause.match(/^([^.]+)\.eq\.(.*)$/);
              if (eqMatch) {
                const [, col, val] = eqMatch;
                return String(item[col] ?? '') === val;
              }
              return false;
            }),
          );
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          sortCol = col;
          sortAsc = opts?.ascending !== false;
          return builder;
        },
        limit(count: number) {
          limitCount = count;
          return builder;
        },
        then(resolve: (res: { data: any; error: any; count?: number }) => any, reject?: (err: any) => any) {
          return execute().then(resolve, reject);
        },
        async single() {
          const res = await execute();
          if (res.error) return { data: null, error: res.error };
          const first = Array.isArray(res.data) ? res.data[0] : res.data;
          return { data: first ?? null, error: first ? null : { message: 'No row found' } };
        },
        async maybeSingle() {
          const res = await execute();
          if (res.error) return { data: null, error: res.error };
          const first = Array.isArray(res.data) ? res.data[0] : res.data;
          return { data: first ?? null, error: null };
        },
      };

      return builder;
    },
  };
}
