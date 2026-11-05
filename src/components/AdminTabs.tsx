import { useState } from 'react';
import { Boxes, ClipboardList } from 'lucide-react';
import AdminPanel from '@/components/AdminPanel';
import InventarioAdmin from '@/components/InventarioAdmin';

type Pestana = 'prestamos' | 'inventario';

const PESTANAS: { id: Pestana; label: string; icon: typeof Boxes }[] = [
  { id: 'prestamos', label: 'Préstamos', icon: ClipboardList },
  { id: 'inventario', label: 'Inventario y stock', icon: Boxes },
];

export default function AdminTabs() {
  const [pestana, setPestana] = useState<Pestana>('prestamos');

  return (
    <div className="space-y-6">
      <div role="tablist" className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {PESTANAS.map(({ id, label, icon: Icon }) => {
          const activa = pestana === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => setPestana(id)}
              className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition ${
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

      {pestana === 'prestamos' ? <AdminPanel /> : <InventarioAdmin />}
    </div>
  );
}
