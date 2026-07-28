import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, Clock } from 'lucide-react';
import type { ScheduledAsset } from '@/store/schedulerStore';
import { MediaImg } from '@/components/MediaImg';

interface Props {
  dateKey: string;
  item: ScheduledAsset;
  onConfirm: (scheduledAt: string) => void;
  onCancel: () => void;
}

function getDefaultTime() {
  const now = new Date();
  const nextSlot = new Date(now);
  const mins = now.getMinutes();
  const nextMins = Math.ceil((mins + 1) / 30) * 30;
  if (nextMins >= 60) {
    nextSlot.setHours(now.getHours() + 1, 0, 0, 0);
  } else {
    nextSlot.setMinutes(nextMins, 0, 0);
  }
  return { hour: nextSlot.getHours(), minute: nextSlot.getMinutes() };
}

function useDragScroll(onStep: (delta: number) => void) {
  const dragRef = useRef<{ startY: number; lastY: number; active: boolean }>({
    startY: 0, lastY: 0, active: false,
  });

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startY: e.clientY, lastY: e.clientY, active: true };
    e.preventDefault();

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current.active) return;
      const delta = dragRef.current.lastY - ev.clientY;
      if (Math.abs(delta) >= 18) {
        onStep(delta > 0 ? 1 : -1);
        dragRef.current.lastY = ev.clientY;
      }
    };

    const onUp = () => {
      dragRef.current.active = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onStep]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (Math.abs(e.deltaY) > 0) {
      onStep(e.deltaY < 0 ? 1 : -1);
    }
  }, [onStep]);

  return { onMouseDown, onWheel };
}

export default function TimePickerModal({ dateKey, item, onConfirm, onCancel }: Props) {
  const def = getDefaultTime();
  const [hour, setHour]     = useState(def.hour);
  const [minute, setMinute] = useState(def.minute);

  const dateLabel = new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  });

  function handleConfirm() {
    const dt = new Date(`${dateKey}T00:00:00`);
    dt.setHours(hour, minute, 0, 0);
    onConfirm(dt.toISOString());
  }

  const cycleHour   = useCallback((d: number) => setHour((h) => (h + d + 24) % 24), []);
  const cycleMinute = useCallback((d: number) => setMinute((m) => m === 0 && d < 0 ? 30 : m === 30 && d > 0 ? 0 : m === 0 ? 30 : 0), []);

  const hourDrag   = useDragScroll(cycleHour);
  const minuteDrag = useDragScroll(cycleMinute);

  return (
    <AnimatePresence>
      <motion.div
        key="time-picker-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
        onClick={onCancel}
      >
        <motion.div
          key="time-picker-modal"
          initial={{ opacity: 0, scale: 0.93, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.93, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="glass-panel rounded-2xl p-6 w-80 mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Asset row */}
          <div className="flex items-center gap-3 mb-5">
            <div className="relative h-11 w-11 rounded-xl overflow-hidden bg-white/5 shrink-0">
              {item.assets[0]?.previewUrl ? (
                <MediaImg src={item.assets[0].previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  <Clock className="h-4 w-4 text-muted-foreground/30" />
                </div>
              )}
              {item.assets.length > 1 && (
                <span className="absolute bottom-0 right-0 rounded-md bg-black/70 px-1 text-[9px] font-bold text-white leading-tight">
                  {item.assets.length}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-body font-satoshi text-foreground font-medium truncate">
                {item.assets.length > 1 ? `${item.assets.length} items · ${item.assets[0]?.name ?? ""}` : item.assets[0]?.name}
              </p>
              <p className="text-micro font-mono text-muted-foreground mt-0.5 truncate">
                {dateLabel}
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-white/[0.08] mb-5" />

          {/* Time picker */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {/* Hour */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={() => cycleHour(1)}
                className="glass-button rounded-lg p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <span
                {...hourDrag}
                className="font-mono text-[2rem] font-bold text-foreground w-14 text-center leading-none tabular-nums cursor-ns-resize select-none"
              >
                {String(hour).padStart(2, '0')}
              </span>
              <button
                onClick={() => cycleHour(-1)}
                className="glass-button rounded-lg p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            <span className="font-mono text-[2rem] font-bold text-muted-foreground/60 leading-none select-none mb-0.5">
              :
            </span>

            {/* Minute */}
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={() => cycleMinute(1)}
                className="glass-button rounded-lg p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <span
                {...minuteDrag}
                className="font-mono text-[2rem] font-bold text-foreground w-14 text-center leading-none tabular-nums cursor-ns-resize select-none"
              >
                {String(minute).padStart(2, '0')}
              </span>
              <button
                onClick={() => cycleMinute(-1)}
                className="glass-button rounded-lg p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Hint */}
          <p className="text-center font-mono text-micro text-muted-foreground/50 -mt-4 mb-5">
            drag or scroll to change · 30‑min steps
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 glass-button rounded-full py-2.5 text-body font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 glass-accent rounded-full py-2.5 text-body font-medium text-white transition-all"
            >
              Schedule
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
