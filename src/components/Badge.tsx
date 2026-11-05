import type { ReactNode } from 'react';

type Variant = 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'purple';

const map: Record<Variant, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  blue: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200',
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
};

export default function Badge({
  children,
  variant = 'gray',
  className = '',
}: {
  children: ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return <span className={`badge ${map[variant]} ${className}`}>{children}</span>;
}

export function estadoUsuarioVariant(e: string): Variant {
  if (e === 'Activo') return 'green';
  if (e === 'Sancionado') return 'yellow';
  return 'gray';
}

export function estadoEquipoVariant(e: string): Variant {
  if (e === 'Disponible') return 'green';
  if (e === 'Reservado') return 'yellow';
  if (e === 'En préstamo') return 'blue';
  if (e === 'En mantenimiento') return 'purple';
  return 'red';
}

export function estadoPrestamoVariant(e: string): Variant {
  if (e === 'Reservado') return 'yellow';
  if (e === 'En Curso') return 'blue';
  if (e === 'Devuelto') return 'green';
  if (e === 'Cancelado') return 'gray';
  return 'red';
}
