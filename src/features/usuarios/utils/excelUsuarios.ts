import * as XLSX from 'xlsx';
import type { Rol } from '@/types/database';
import type { UsuarioAdmin } from '@/features/usuarios/services/usuariosService';

export type CampoExcelUsuario = 'dni' | 'nombre' | 'apellido' | 'email' | 'telefono' | 'curso' | 'rol';

export type FilaExcelUsuario = {
  filaNumero: number;
  accion: 'crear' | 'actualizar' | 'error';
  errores: string[];
  dni: string;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  curso: string;
  rolesIds: string[];
  rolesNombres: string[];
  idUsuarioExistente?: string;
  estadoExistente?: UsuarioAdmin['estado'];
};

export type ResultadoParseoExcel = {
  columnasDetectadas: { campo: CampoExcelUsuario; encabezadoOriginal: string }[];
  columnasIgnoradas: string[];
  columnasFaltantes: CampoExcelUsuario[];
  tieneColumnaTelefono: boolean;
  tieneColumnaCurso: boolean;
  tieneColumnaRol: boolean;
  filas: FilaExcelUsuario[];
};

const ALIAS_ENCABEZADOS: Record<CampoExcelUsuario, string[]> = {
  dni: ['dni', 'documento', 'nro documento', 'numero documento', 'n documento', 'dni documento', 'doc'],
  nombre: ['nombre', 'nombres', 'first name'],
  apellido: ['apellido', 'apellidos', 'last name'],
  email: ['email', 'e mail', 'mail', 'correo', 'correo electronico', 'email institucional'],
  telefono: ['telefono', 'tel', 'celular', 'cel', 'movil', 'whatsapp'],
  curso: ['curso', 'anio', 'ano', 'anio cursado', 'ano cursado', 'nivel'],
  rol: ['rol', 'roles', 'perfil', 'tipo', 'cargo'],
};

const CAMPOS_OBLIGATORIOS: CampoExcelUsuario[] = ['dni', 'nombre', 'apellido', 'email'];

function normalizarTexto(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mapearEncabezado(raw: unknown): CampoExcelUsuario | null {
  const norm = normalizarTexto(raw);
  if (!norm) return null;
  for (const campo of Object.keys(ALIAS_ENCABEZADOS) as CampoExcelUsuario[]) {
    if (ALIAS_ENCABEZADOS[campo].includes(norm)) return campo;
  }
  return null;
}

function limpiarCelda(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

function normalizarDni(raw: unknown): string {
  const str = limpiarCelda(raw);
  if (!str) return '';
  const soloDigitosYPuntos = str.replace(/[.\s-]/g, '');
  if (/^\d+$/.test(soloDigitosYPuntos)) return soloDigitosYPuntos;
  return str;
}

function normalizarCurso(raw: unknown): { valido: boolean; valor: string } {
  const original = limpiarCelda(raw);
  if (!original) return { valido: true, valor: '' };
  const norm = normalizarTexto(original);
  if (['', '-', 'sin curso', 'no aplica', 'ninguno', 'na', 'n a'].includes(norm)) {
    return { valido: true, valor: '' };
  }
  if (['1', '1o', '1ro', '1er', 'primero', '1 ano', '1 anio', '1er ano', '1er anio', '1 curso'].includes(norm)) {
    return { valido: true, valor: '1°' };
  }
  if (['2', '2o', '2do', 'segundo', '2 ano', '2 anio', '2do ano', '2do anio', '2 curso'].includes(norm)) {
    return { valido: true, valor: '2°' };
  }
  if (['3', '3o', '3ro', '3er', 'tercero', '3 ano', '3 anio', '3er ano', '3er anio', '3 curso'].includes(norm)) {
    return { valido: true, valor: '3°' };
  }
  if (['egresado', 'egresada', 'graduado', 'graduada'].includes(norm)) {
    return { valido: true, valor: 'Egresado' };
  }
  return { valido: false, valor: original };
}

function resolverRoles(
  raw: string,
  rolesDisponibles: Rol[],
  rolPorDefectoId: string,
): { valido: boolean; ids: string[]; nombres: string[]; error?: string } {
  const limpio = raw.trim();
  if (!limpio) {
    const def = rolesDisponibles.find((r) => r.id_rol === rolPorDefectoId) ?? rolesDisponibles[0];
    return def ? { valido: true, ids: [def.id_rol], nombres: [def.nombre] } : { valido: false, ids: [], nombres: [], error: 'Sin rol disponible' };
  }

  const partes = limpio
    .split(/[,;/+|]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const ids: string[] = [];
  const nombres: string[] = [];
  const desconocidos: string[] = [];

  for (const parte of partes) {
    const norm = normalizarTexto(parte);
    let encontrado = rolesDisponibles.find((r) => normalizarTexto(r.nombre) === norm);
    if (!encontrado) {
      if (['alumno', 'alumna', 'estudiantes'].includes(norm)) {
        encontrado = rolesDisponibles.find((r) => r.nombre === 'Estudiante');
      } else if (['profesor', 'profesora', 'docente', 'adjunto'].includes(norm)) {
        encontrado = rolesDisponibles.find((r) => r.nombre === 'Profesor Adjunto');
      } else if (['admin', 'administrador', 'administrativa', 'panol'].includes(norm)) {
        encontrado = rolesDisponibles.find((r) => r.nombre === 'Administrativo');
      }
    }
    if (!encontrado) {
      desconocidos.push(parte);
    } else if (!ids.includes(encontrado.id_rol)) {
      ids.push(encontrado.id_rol);
      nombres.push(encontrado.nombre);
    }
  }

  if (desconocidos.length > 0) {
    return {
      valido: false,
      ids: [],
      nombres: [],
      error: `Rol desconocido (${desconocidos.join(', ')})`,
    };
  }

  return { valido: true, ids, nombres };
}

export function leerLibroExcel(buffer: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: 'array' });
}

export function parsearHojaUsuarios(
  wb: XLSX.WorkBook,
  sheetName: string,
  usuariosExistentes: UsuarioAdmin[],
  rolesDisponibles: Rol[],
  rolPorDefectoId: string,
): ResultadoParseoExcel {
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return {
      columnasDetectadas: [],
      columnasIgnoradas: [],
      columnasFaltantes: [...CAMPOS_OBLIGATORIOS],
      tieneColumnaTelefono: false,
      tieneColumnaCurso: false,
      tieneColumnaRol: false,
      filas: [],
    };
  }

  const matriz = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', blankrows: false });
  if (matriz.length === 0) {
    return {
      columnasDetectadas: [],
      columnasIgnoradas: [],
      columnasFaltantes: [...CAMPOS_OBLIGATORIOS],
      tieneColumnaTelefono: false,
      tieneColumnaCurso: false,
      tieneColumnaRol: false,
      filas: [],
    };
  }

  // Buscar fila de encabezados entre las primeras 5 filas
  let headerRowIdx = 0;
  let mejorPuntaje = -1;
  const limiteBusqueda = Math.min(matriz.length, 5);
  for (let i = 0; i < limiteBusqueda; i++) {
    const row = matriz[i] ?? [];
    const encontrados = new Set<CampoExcelUsuario>();
    for (const cell of row) {
      const m = mapearEncabezado(cell);
      if (m) encontrados.add(m);
    }
    if (encontrados.size > mejorPuntaje) {
      mejorPuntaje = encontrados.size;
      headerRowIdx = i;
    }
  }

  const headerRow = matriz[headerRowIdx] ?? [];
  const indicePorCampo = new Map<CampoExcelUsuario, number>();
  const columnasDetectadas: { campo: CampoExcelUsuario; encabezadoOriginal: string }[] = [];
  const columnasIgnoradas: string[] = [];

  headerRow.forEach((cell, colIdx) => {
    const raw = limpiarCelda(cell);
    const campo = mapearEncabezado(raw);
    if (campo && !indicePorCampo.has(campo)) {
      indicePorCampo.set(campo, colIdx);
      columnasDetectadas.push({ campo, encabezadoOriginal: raw });
    } else if (raw) {
      columnasIgnoradas.push(raw);
    }
  });

  const columnasFaltantes = CAMPOS_OBLIGATORIOS.filter((c) => !indicePorCampo.has(c));
  const tieneColumnaTelefono = indicePorCampo.has('telefono');
  const tieneColumnaCurso = indicePorCampo.has('curso');
  const tieneColumnaRol = indicePorCampo.has('rol');

  if (columnasFaltantes.length > 0) {
    return {
      columnasDetectadas,
      columnasIgnoradas,
      columnasFaltantes,
      tieneColumnaTelefono,
      tieneColumnaCurso,
      tieneColumnaRol,
      filas: [],
    };
  }

  const porDni = new Map<string, UsuarioAdmin>();
  const porEmail = new Map<string, UsuarioAdmin>();
  for (const u of usuariosExistentes) {
    porDni.set(u.dni.trim(), u);
    porEmail.set(u.email.trim().toLowerCase(), u);
  }

  const dnisVistos = new Set<string>();
  const emailsVistos = new Map<string, string>(); // email -> dni
  const filas: FilaExcelUsuario[] = [];

  for (let r = headerRowIdx + 1; r < matriz.length; r++) {
    const row = matriz[r] ?? [];
    const vacia = row.every((c) => limpiarCelda(c) === '');
    if (vacia) continue;

    const get = (campo: CampoExcelUsuario): unknown => {
      const idx = indicePorCampo.get(campo);
      return idx === undefined ? '' : row[idx];
    };

    const dni = normalizarDni(get('dni'));
    const nombre = limpiarCelda(get('nombre'));
    const apellido = limpiarCelda(get('apellido'));
    const email = limpiarCelda(get('email')).toLowerCase();
    const telefonoRaw = limpiarCelda(get('telefono'));
    const cursoRaw = get('curso');
    const rolRaw = limpiarCelda(get('rol'));

    const existente = dni ? porDni.get(dni) : undefined;
    const errores: string[] = [];

    if (!dni) {
      errores.push('Falta DNI');
    } else {
      if (!existente && dni.length < 6) {
        errores.push('El DNI debe tener al menos 6 caracteres (se usa como contraseña inicial)');
      }
      if (dnisVistos.has(dni)) {
        errores.push('DNI duplicado en el archivo');
      } else {
        dnisVistos.add(dni);
      }
    }

    if (!nombre) errores.push('Falta nombre');
    if (!apellido) errores.push('Falta apellido');

    if (!email) {
      errores.push('Falta email');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errores.push('Email con formato inválido');
    } else {
      const otroDb = porEmail.get(email);
      if (otroDb && otroDb.dni.trim() !== dni) {
        errores.push(`El email ya pertenece a otro usuario (DNI ${otroDb.dni})`);
      }
      const dniEmailPrevio = emailsVistos.get(email);
      if (dniEmailPrevio && dniEmailPrevio !== dni) {
        errores.push(`Email repetido con otra fila del Excel (DNI ${dniEmailPrevio})`);
      } else if (dni) {
        emailsVistos.set(email, dni);
      }
    }

    const cursoRes = tieneColumnaCurso
      ? normalizarCurso(cursoRaw)
      : { valido: true, valor: existente?.curso ?? '' };
    if (!cursoRes.valido) {
      errores.push(`Curso "${cursoRes.valor}" inválido (usar 1°, 2°, 3°, Egresado o vacío)`);
    }

    let rolesIds: string[] = [];
    let rolesNombres: string[] = [];
    if (tieneColumnaRol && rolRaw !== '') {
      const rolRes = resolverRoles(rolRaw, rolesDisponibles, rolPorDefectoId);
      if (!rolRes.valido) {
        errores.push(rolRes.error || 'Rol inválido');
      } else {
        rolesIds = rolRes.ids;
        rolesNombres = rolRes.nombres;
      }
    } else if (existente && existente.roles.length > 0) {
      rolesIds = existente.roles.map((rol) => rol.id_rol);
      rolesNombres = existente.roles.map((rol) => rol.nombre);
    } else {
      const rolRes = resolverRoles('', rolesDisponibles, rolPorDefectoId);
      if (!rolRes.valido) {
        errores.push(rolRes.error || 'Rol por defecto inválido');
      } else {
        rolesIds = rolRes.ids;
        rolesNombres = rolRes.nombres;
      }
    }

    const telefonoFinal = tieneColumnaTelefono ? telefonoRaw : existente?.telefono ?? '';

    filas.push({
      filaNumero: r + 1,
      accion: errores.length > 0 ? 'error' : existente ? 'actualizar' : 'crear',
      errores,
      dni,
      nombre,
      apellido,
      email,
      telefono: telefonoFinal,
      curso: cursoRes.valor,
      rolesIds,
      rolesNombres,
      idUsuarioExistente: existente?.id_usuario,
      estadoExistente: existente?.estado,
    });
  }

  return {
    columnasDetectadas,
    columnasIgnoradas,
    columnasFaltantes,
    tieneColumnaTelefono,
    tieneColumnaCurso,
    tieneColumnaRol,
    filas,
  };
}

export function descargarPlantillaPadronExcel(): void {
  const filasEjemplo = [
    {
      dni: '40123456',
      nombre: 'Lucía',
      apellido: 'Gómez',
      email: 'lucia.gomez@itu.edu.ar',
      telefono: '261-555-0101',
      curso: '1°',
      rol: 'Estudiante',
    },
    {
      dni: '38654321',
      nombre: 'Martín',
      apellido: 'Pereyra',
      email: 'martin.pereyra@itu.edu.ar',
      telefono: '',
      curso: 'Egresado',
      rol: 'Estudiante',
    },
    {
      dni: '29444555',
      nombre: 'Laura',
      apellido: 'Díaz',
      email: 'laura.diaz@itu.edu.ar',
      telefono: '261-555-0199',
      curso: '',
      rol: 'Profesor Adjunto',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(filasEjemplo);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 28 },
    { wch: 16 },
    { wch: 12 },
    { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Padron');
  XLSX.writeFile(wb, 'plantilla_padron_itu.xlsx');
}
