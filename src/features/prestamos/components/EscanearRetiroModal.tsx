import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CameraOff, KeyRound, QrCode, Search } from 'lucide-react';
import jsQR from 'jsqr';
import ModalFrame from '@/components/ui/ModalFrame';
import { useAuth } from '@/context/AuthContext';
import {
  buscarPrestamoPorCodigo,
  extraerCodigoRetiro,
  type PrestamoPorCodigo,
} from '@/features/prestamos/services/qrRetiroService';
import { cargarConfiguracionHorarios, evaluarVentanaRetiro } from '@/features/configuracion/services/horariosService';
import { verificarYCaducarReservasVencidas } from '@/features/prestamos/services/prestamosService';

export default function EscanearRetiroModal({
  onCerrar,
  onEncontrado,
}: {
  onCerrar: () => void;
  onEncontrado: (prestamo: PrestamoPorCodigo, metodo: 'qr' | 'codigo') => void;
}) {
  const { session } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const bloqueadoScanRef = useRef(false);

  const [camaraEstado, setCamaraEstado] = useState<'iniciando' | 'activa' | 'error'>('iniciando');
  const [camaraError, setCamaraError] = useState<string | null>(null);
  const [codigoManual, setCodigoManual] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detenerCamara = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const procesarCodigo = useCallback(
    async (raw: string, metodo: 'qr' | 'codigo') => {
      if (!session) return;
      const limpio = extraerCodigoRetiro(raw);
      if (limpio.length < 4) {
        setError('El código debe tener al menos 4 caracteres.');
        return;
      }

      bloqueadoScanRef.current = true;
      setBuscando(true);
      setError(null);

      try {
        const [prestamo, cfg] = await Promise.all([
          buscarPrestamoPorCodigo(session.token, limpio),
          cargarConfiguracionHorarios().catch(() => ({ tolerancia_retiro_min: 5 })),
        ]);
        if (prestamo.estado !== 'Reservado' && prestamo.estado !== 'En Curso') {
          setError(
            `El préstamo ${prestamo.codigo_retiro} figura como "${prestamo.estado}" y no admite entrega ni devolución.`,
          );
          bloqueadoScanRef.current = false;
          return;
        }
        if (prestamo.estado === 'Reservado') {
          const ventana = evaluarVentanaRetiro(prestamo, cfg.tolerancia_retiro_min);
          if (ventana.estado !== 'sin_franja' && ventana.estado !== 'en_horario') {
            if (ventana.estado === 'vencido') {
              await verificarYCaducarReservasVencidas().catch(() => undefined);
            }
            setError(ventana.mensaje);
            bloqueadoScanRef.current = false;
            return;
          }
        }
        detenerCamara();
        onEncontrado(prestamo, metodo);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se encontró una reserva con ese código.');
        bloqueadoScanRef.current = false;
      } finally {
        setBuscando(false);
      }
    },
    [detenerCamara, onEncontrado, session],
  );

  const iniciarCamara = useCallback(async () => {
    detenerCamara();
    bloqueadoScanRef.current = false;
    setCamaraEstado('iniciando');
    setCamaraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCamaraEstado('error');
      setCamaraError('Este navegador no permite abrir la cámara. Ingresá el código de 4 caracteres abajo.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setCamaraEstado('activa');

      const escanearCuadro = () => {
        const vid = videoRef.current;
        const canvas = canvasRef.current;
        if (!vid || !canvas || !streamRef.current) return;

        if (!bloqueadoScanRef.current && vid.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
          const w = vid.videoWidth;
          const h = vid.videoHeight;
          if (w > 0 && h > 0) {
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(vid, 0, 0, w, h);
              const imgData = ctx.getImageData(0, 0, w, h);
              const code = jsQR(imgData.data, w, h, { inversionAttempts: 'dontInvert' });
              if (code?.data) {
                const limpio = extraerCodigoRetiro(code.data);
                if (limpio.length >= 4) {
                  void procesarCodigo(code.data, 'qr');
                }
              }
            }
          }
        }
        rafRef.current = requestAnimationFrame(escanearCuadro);
      };

      rafRef.current = requestAnimationFrame(escanearCuadro);
    } catch {
      setCamaraEstado('error');
      setCamaraError('No pudimos acceder a la cámara (o se rechazó el permiso). Usá el código opcional de abajo.');
    }
  }, [detenerCamara, procesarCodigo]);

  useEffect(() => {
    void iniciarCamara();
    return () => {
      detenerCamara();
    };
  }, [detenerCamara, iniciarCamara]);

  const enviarManual = (e: FormEvent) => {
    e.preventDefault();
    void procesarCodigo(codigoManual, 'codigo');
  };

  return (
    <ModalFrame
      titulo="Escanear entrega / devolución"
      onCerrar={() => {
        detenerCamara();
        onCerrar();
      }}
      footer={
        <button
          type="button"
          onClick={() => {
            detenerCamara();
            onCerrar();
          }}
          className="btn-secondary"
        >
          Cerrar
        </button>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Visor de cámara móvil */}
        <div className="space-y-2">
          <div className="relative mx-auto aspect-square w-full max-w-[260px] overflow-hidden rounded-2xl border border-gray-200 bg-gray-950 dark:border-gray-800">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`h-full w-full object-cover ${camaraEstado === 'activa' ? 'opacity-100' : 'opacity-0'}`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {camaraEstado === 'activa' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
                <div className="h-full w-full rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
            )}

            {camaraEstado === 'iniciando' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-gray-300">
                <Camera size={28} className="animate-pulse text-brand-400" />
                <span>Abriendo cámara trasera…</span>
              </div>
            )}

            {camaraEstado === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-4 text-center text-xs text-gray-300">
                <CameraOff size={28} className="text-gray-400" />
                <span>{camaraError}</span>
                <button
                  type="button"
                  onClick={() => void iniciarCamara()}
                  className="btn-secondary mt-1 py-1.5 text-xs"
                >
                  Reintentar cámara
                </button>
              </div>
            )}
          </div>

          {camaraEstado === 'activa' && (
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-gray-500">
              <QrCode size={14} className="text-brand-600" />
              Apuntá al QR del alumno para entregar o recibir equipos
            </p>
          )}
        </div>

        {/* Respaldo manual por código corto */}
        <form
          onSubmit={enviarManual}
          className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 dark:border-gray-800 dark:bg-gray-900/60"
        >
          <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
            <KeyRound size={14} className="text-brand-600" />
            ¿No funciona el QR? Ingresá el código del alumno
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="input h-12 flex-1 text-center font-mono text-xl font-bold uppercase tracking-[0.22em]"
              placeholder="Ej: K472"
              value={codigoManual}
              onChange={(e) => setCodigoManual(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={16}
            />
            <button
              type="submit"
              disabled={buscando || codigoManual.trim().length < 4}
              className="btn-primary h-12 shrink-0 px-5"
            >
              <Search size={16} /> {buscando ? 'Buscando…' : 'Buscar préstamo'}
            </button>
          </div>
        </form>
      </div>
    </ModalFrame>
  );
}
