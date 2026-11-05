import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export default function ModalFrame({
  titulo,
  onCerrar,
  children,
  footer,
}: {
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-card dark:bg-gray-950 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{titulo}</h3>
          <button type="button" onClick={onCerrar} className="btn-ghost h-9 w-9 !px-0" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">{footer}</div>
      </div>
    </div>
  );
}
