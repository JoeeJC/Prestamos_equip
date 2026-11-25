import { useState } from 'react';
import { Boxes, ClipboardList, Settings, Users } from 'lucide-react';
import AdminPanel from '@/features/prestamos/components/admin/AdminPanel';
import InventarioAdmin from '@/features/inventario/components/InventarioAdmin';
import LimitesReservaPanel from '@/features/configuracion/components/LimitesReservaPanel';
import UsuariosAdminPanel from '@/features/usuarios/components/UsuariosAdminPanel';

type Pestana = 'prestamos' | 'inventario' | 'usuarios' | 'configuracion';

const PESTANAS: { id: Pestana; label: string; icon: typeof Boxes }[] = [
  { id: 'prestamos', label: 'Préstamos', icon: ClipboardList },
  { id: 'inventario', label: 'Inventario y stock', icon: Boxes },
  { id: 'usuarios', label: 'Usuarios y padrón', icon: Users },
  { id: 'configuracion', label: 'Límites de reserva', icon: Settings },
];

export default function AdminTabs({
  codigoRetiroInicial,
  onConsumirCodigoRetiro,
}: {
  codigoRetiroInicial?: string | null;
  onConsumirCodigoRetiro?: () => void;
}) {
  const [pestana, setPestana] = useState<Pestana>('prestamos');

  return (
    <div className="space-y-6">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
        {PESTANAS.map(({ id, label, icon: Icon }) => {
          const activa = pestana === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => setPestana(id)}
              className={`relative flex shrink-0 items-center gap-2 px-4 py-3 text-sm font-medium transition ${
                activa
                  ? 'text-brand-600 dark:text-brand-300'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <Icon size={16} />
              <span>{label}</span>
              {activa && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />}
            </button>
          );
        })}
      </div>

      {(pestana === 'prestamos' || codigoRetiroInicial) && (
        <AdminPanel
          codigoRetiroInicial={codigoRetiroInicial}
          onConsumirCodigoRetiro={onConsumirCodigoRetiro}
        />
      )}
      {!codigoRetiroInicial && pestana === 'inventario' && <InventarioAdmin />}
      {!codigoRetiroInicial && pestana === 'usuarios' && <UsuariosAdminPanel />}
      {!codigoRetiroInicial && pestana === 'configuracion' && <LimitesReservaPanel />}
    </div>
  );
}
