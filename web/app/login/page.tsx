import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { signIn } from './actions';

export default function LoginPage() {
  return (
    <main className="login">
      <div className="card login-card">
        <h1>ERP de personal</h1>
        <p className="muted">Inicia sesión con la cuenta que te dio el administrador.</p>
        <ActionForm action={signIn} className="stack">
          <label>Correo<input name="email" type="email" autoComplete="email" required /></label>
          <label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label>
          <SubmitButton pendingText="Entrando…">Entrar</SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
