/**
 * toast-context.tsx — Single-toast model with 3-second auto-dismiss.
 *
 * Usage:
 *   <ToastProvider>
 *     <App />
 *   </ToastProvider>
 *
 * In any component:
 *   const { show } = useToast();
 *   show("Transaction added!", "success");
 */
import { createContext, useContext, useRef, useState } from "react";

type ToastVariant = "success" | "error";

interface ToastState {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  show: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}

interface ToastRootProps {
  toast: ToastState | null;
}

function ToastRoot({ toast }: ToastRootProps) {
  if (toast === null) return null;

  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg bg-gray-800 px-4 py-3 text-white shadow-lg"
    >
      {toast.message}
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const idRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  function show(message: string, variant: ToastVariant = "success"): void {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    const id = ++idRef.current;
    setToast({ id, message, variant });
    timerRef.current = window.setTimeout(() => {
      setToast((t) => (t?.id === id ? null : t));
    }, 3000);
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastRoot toast={toast} />
    </ToastContext.Provider>
  );
}
