import { createContext, useContext, useState, type ReactNode } from 'react';
import { CaptureDialog } from './capture-dialog.js';

export type CaptureRequest = { kind?: 'task' | 'reading' | 'habit' | 'transaction'; metricId?: string };
const CaptureContext = createContext<(request?: CaptureRequest) => void>(() => {});
export const useCapture = () => useContext(CaptureContext);

export function CaptureProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<CaptureRequest | null>(null);
  return <CaptureContext.Provider value={(next = {}) => setRequest(next)}>
    {children}
    {request && <CaptureDialog request={request} onClose={() => setRequest(null)} />}
  </CaptureContext.Provider>;
}
