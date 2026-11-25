import { useEffect, useState } from 'react';
import { Check, Copy, QrCode, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import ModalFrame from '@/components/ui/ModalFrame';
import { construirPayloadQR } from '@/features/prestamos/services/qrRetiroService';
import type { DetallePrestamo, Prestamo } from '@/types/database';

type PrestamoParaQR = Prestamo & { detalle_prestamos?: DetallePrestamo[] };

export default function QrRetiroModal({
  prestamo,
  nombreUsuario,
  onCerrar,
  onActualizar,
}: {
  prestamo: PrestamoParaQR;
  nombreUsuario: string;
  onCerrar: () => void;
  onActualizar: () => void;
}) {
  const codigo = (prestamo.codigo_retiro ?? '').toUpperCase();
  const esDevolucion = prestamo.estado === 'En Curso';
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!codigo) return;
    let activo = true;
    QRCode.toDataURL(construirPayloadQR(codigo), {
      width: 280,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#FFFFFF' },
    })
      .then((url) => {
        if (activo) setQrDataUrl(url);
      })
      .catch(() => {
        if (activo) setQrDataUrl('');
      });
    return () => {
      activo = false;
    };
  }, [codigo]);

  const copiarCodigo = async () => {
    if (!codigo || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Silencioso si el navegador bloquea portapapeles
    }
  };

  return (
    <ModalFrame
      titulo={esDevolucion ? 'Pase de devolución' : 'Pase de retiro'}
      onCerrar={onCerrar}
      footer={
        <>
          <button type="button" onClick={onCerrar} className="btn-secondary">
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => {
              onActualizar();
              onCerrar();
            }}
            className="btn-primary"
          >
            <RefreshCw size={15} /> {esDevolucion ? 'Ya devolví' : 'Ya me entregaron'}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-center">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {esDevolucion
            ? 'Mostrale este QR al encargado del pañol para confirmar la devolución de tus equipos.'
            : 'Mostrale este QR al encargado del pañol para confirmar el retiro de tus equipos.'}
        </p>

        {/* Fondo siempre blanco para lectura confiable en cualquier celular */}
        <div className="mx-auto inline-flex flex-col items-center rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`Código QR de ${esDevolucion ? 'devolución' : 'retiro'} ${codigo}`}
              className="h-56 w-56 select-none sm:h-64 sm:w-64"
            />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center text-gray-400">
              <QrCode size={48} className="animate-pulse" />
            </div>
          )}
        </div>

        {/* Código alternativo */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/60">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Código opcional (si no funciona la cámara)
          </p>
          <div className="mt-1.5 flex items-center justify-center gap-2">
            <span className="font-mono text-2xl font-bold tracking-[0.25em] text-gray-900 dark:text-white sm:text-3xl">
              {codigo || '—'}
            </span>
            {codigo && (
              <button
                type="button"
                onClick={() => void copiarCodigo()}
                className="btn-ghost h-9 w-9 !px-0"
                title="Copiar código"
                aria-label="Copiar código"
              >
                {copiado ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
              </button>
            )}
          </div>
        </div>

        {/* Resumen compacto */}
        <div className="rounded-xl border border-gray-200 p-3 text-left text-xs dark:border-gray-800">
          <p className="font-semibold text-gray-900 dark:text-white">{nombreUsuario}</p>
          <p className="mt-0.5 text-gray-500">
            {new Date(prestamo.fecha_prestamo + 'T00:00:00').toLocaleDateString('es-AR')} ·{' '}
            {prestamo.hora_inicio_prevista.slice(0, 5)} a {prestamo.hora_fin_prevista.slice(0, 5)} hs
          </p>
          {prestamo.retiro_desde && prestamo.retiro_hasta && (
            <p className="mt-0.5 font-medium text-brand-700 dark:text-brand-300">
              Ventana de retiro: {prestamo.retiro_desde.slice(0, 5)} a {prestamo.retiro_hasta.slice(0, 5)} hs
            </p>
          )}
          {prestamo.detalle_prestamos && prestamo.detalle_prestamos.length > 0 && (
            <p className="mt-1.5 font-medium text-gray-700 dark:text-gray-300">
              Equipos:{' '}
              {prestamo.detalle_prestamos
                .map((d) => d.equipos?.codigo_inventario)
                .filter(Boolean)
                .join(', ')}
            </p>
          )}
        </div>
      </div>
    </ModalFrame>
  );
}
