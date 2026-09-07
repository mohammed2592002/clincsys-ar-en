import React, { createContext, useContext, useState, useRef, ReactNode } from 'react';
import { AlertTriangle, Info, CheckCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface DialogOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'alert' | 'confirm';
  severity?: 'info' | 'warning' | 'error' | 'success';
}

interface DialogContextType {
  alert: (message: string, options?: DialogOptions) => Promise<void>;
  confirm: (message: string, options?: DialogOptions) => Promise<boolean>;
}

const DialogContext = createContext<DialogContextType | undefined>(undefined);

export function useDialogs() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialogs must be used within a DialogProvider');
  }
  return context;
}

interface DialogProviderProps {
  children: ReactNode;
}

export function DialogProvider({ children }: DialogProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [options, setOptions] = useState<DialogOptions>({});
  
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const alert = (message: string, opt?: DialogOptions): Promise<void> => {
    setMessage(message);
    setOptions({
      title: opt?.title || 'تنبيه',
      confirmText: opt?.confirmText || 'حسناً',
      type: 'alert',
      severity: opt?.severity || 'info',
    });
    setIsOpen(true);
    
    return new Promise<void>((resolve) => {
      resolverRef.current = () => {
        resolve();
      };
    });
  };

  const confirm = (message: string, opt?: DialogOptions): Promise<boolean> => {
    setMessage(message);
    setOptions({
      title: opt?.title || 'تأكيد الإجراء',
      confirmText: opt?.confirmText || 'نعم، متأكد',
      cancelText: opt?.cancelText || 'إلغاء',
      type: 'confirm',
      severity: opt?.severity || 'warning',
    });
    setIsOpen(true);
    
    return new Promise<boolean>((resolve) => {
      resolverRef.current = (value: boolean) => {
        resolve(value);
      };
    });
  };

  const handleConfirm = () => {
    setIsOpen(false);
    if (resolverRef.current) {
      resolverRef.current(true);
    }
  };

  const handleCancel = () => {
    setIsOpen(false);
    if (resolverRef.current) {
      resolverRef.current(false);
    }
  };

  const getIcon = () => {
    const severity = options.severity || 'info';
    switch (severity) {
      case 'warning':
        return <AlertTriangle className="h-10 w-10 text-amber-500 animate-bounce" />;
      case 'error':
        return <X className="h-10 w-10 text-rose-500 animate-pulse bg-rose-50 p-1.5 rounded-full" />;
      case 'success':
        return <CheckCircle className="h-10 w-10 text-emerald-500" />;
      default:
        return <Info className="h-10 w-10 text-sky-500" />;
    }
  };

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-slate-900/65 backdrop-blur-[2px] flex items-center justify-center z-[99999] p-4"
            dir="rtl"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="bg-white rounded-2xl border border-slate-200/80 shadow-2xl max-w-md w-full overflow-hidden p-6 flex flex-col items-center text-center"
            >
              {/* Severity Icon */}
              <div className="mb-4 bg-slate-50 p-3 rounded-full border border-slate-100">
                {getIcon()}
              </div>

              {/* Title */}
              <h3 className="text-base font-extrabold text-slate-800 mb-2">
                {options.title}
              </h3>

              {/* Message */}
              <div className="max-h-[50vh] overflow-y-auto scroll-smooth pr-1 mb-6 text-xs text-slate-600 font-medium leading-relaxed whitespace-pre-line text-center [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
                {message}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 w-full justify-center">
                {options.type === 'confirm' && (
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 max-w-[140px] py-2 px-4 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 transition active:scale-95"
                  >
                    {options.cancelText || 'إلغاء'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleConfirm}
                  className={`flex-1 max-w-[140px] py-2 px-4 rounded-xl text-xs font-bold text-white transition shadow-sm active:scale-95 ${
                    options.severity === 'error'
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : options.severity === 'success'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : options.severity === 'warning'
                      ? 'bg-amber-500 hover:bg-amber-600'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {options.confirmText || 'حسناً'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </DialogContext.Provider>
  );
}
