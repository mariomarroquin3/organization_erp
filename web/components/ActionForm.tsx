'use client';
import {
  createContext, startTransition, useActionState, useContext, useEffect, useRef, type FormEvent, type ReactNode,
} from 'react';
import type { ActionState } from '@/lib/action';

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

/**
 * Llama a una acción de servidor sin usar <form action>, porque React 19
 * vacía los campos del formulario al terminar la acción y el usuario
 * perdería lo escrito cuando hay un error. Devuelve el estado, el
 * manejador de submit y si está guardando.
 */
export function useFormAction(action: Action, confirm?: string) {
  const [state, dispatch, pending] = useActionState(action, { ok: true, message: '' });
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return { state, onSubmit, pending };
}

/** Formulario que llama a una acción de servidor y muestra el resultado. */
export function ActionForm({
  action, children, className, resetOnSuccess = false, confirm,
}: {
  action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean; confirm?: string;
}) {
  const { state, onSubmit, pending } = useFormAction(action, confirm);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && state.at && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <PendingContext.Provider value={pending}>
      <form ref={ref} onSubmit={onSubmit} className={className}>
        {children}
        <FormMessage state={state} />
      </form>
    </PendingContext.Provider>
  );
}

export function PendingProvider({ pending, children }: { pending: boolean; children: ReactNode }) {
  return <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>;
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message && !state.errors?.length) return null;
  return (
    <div className={`msg ${state.ok ? 'msg-ok' : 'msg-error'}`} role={state.ok ? 'status' : 'alert'}>
      {state.message}
      {state.errors?.length ? <ul>{state.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
    </div>
  );
}

export function SubmitButton({ children, className = 'btn', pendingText = 'Guardando…' }: {
  children: ReactNode; className?: string; pendingText?: string;
}) {
  const pending = useContext(PendingContext);
  return <button type="submit" className={className} disabled={pending}>{pending ? pendingText : children}</button>;
}
