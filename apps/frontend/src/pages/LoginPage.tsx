/**
 * LoginPage — single password field login screen.
 *
 * Uses apiClient.post with skipAuthRedirect:true so a 401 from the
 * login endpoint does NOT trigger the global redirect interceptor.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { apiClient, UnauthorizedError } from "../lib/api-client";

export function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password.trim() === "") {
      setError("Ingresá tu password");
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post("/api/auth/login", { password }, { skipAuthRedirect: true });
      login();
      void navigate("/");
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setError("Password incorrecto");
      } else if (err instanceof TypeError) {
        setError("Error de conexión. Intentá nuevamente.");
      } else {
        setError("Ocurrió un error. Intentá nuevamente.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-gray-950">
      <div className="w-full max-w-sm rounded-xl bg-gray-900 p-8 shadow-lg">
        <h1 className="mb-6 text-center text-2xl font-bold tracking-tight text-white">
          CryptoLedger
        </h1>
        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
          <div className="mb-4">
            <label htmlFor="password" className="mb-1 block text-sm text-gray-400">
              Password
            </label>
            <input
              id="password"
              type="password"
              name="password"
              placeholder="Ingresá tu password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); }}
              disabled={submitting}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          {/* Alert zone — always present in DOM to avoid layout shifts */}
          <p
            role="alert"
            className={`mb-4 text-sm text-red-400 ${error ? "visible" : "invisible"}`}
          >
            {error ?? " "}
          </p>

          <button
            type="submit"
            disabled={submitting}
            aria-disabled={submitting}
            className="w-full rounded-lg bg-indigo-600 py-2 font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
