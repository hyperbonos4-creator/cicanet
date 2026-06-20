"use client";

import { useEffect, useState } from "react";
import {
  listUsuarios,
  crearUsuario,
  actualizarUsuario,
  resetPasswordUsuario,
  setEstadoUsuario,
  type Usuario,
} from "../../lib/api";

const ROLES = ["admin", "operador", "tecnico", "contador"];
const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  operador: "Operador NOC",
  tecnico: "Técnico",
  contador: "Contabilidad",
};

const input =
  "rounded-xl border border-cica-border bg-cica-navy/80 px-3 py-2 text-sm text-cica-silver outline-none focus:border-cica-gold";

/**
 * Apartado de Usuarios: control del staff (admin/operador/técnico/contador).
 * Crear usuarios, asignar ID de empleado y rol, resetear contraseña y activar/
 * desactivar accesos. Los clientes inician sesión con su documento aparte.
 */
export default function UsuariosPanel({ currentUserId }: { currentUserId?: string }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      setUsuarios(await listUsuarios());
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function toggleEstado(u: Usuario) {
    const nuevo = u.estado === "activo" ? "inactivo" : "activo";
    try {
      await setEstadoUsuario(u.id, nuevo);
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function resetPwd(u: Usuario) {
    const nueva = prompt(`Nueva contraseña para ${u.nombre} (mínimo 6 caracteres):`, "");
    if (!nueva) return;
    try {
      await resetPasswordUsuario(u.id, nueva);
      setMsg(`Contraseña actualizada para ${u.username}.`);
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function cambiarRol(u: Usuario, role: string) {
    try {
      await actualizarUsuario(u.id, { role });
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const activos = usuarios.filter((u) => u.estado === "activo").length;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-xl font-extrabold text-white">Usuarios</h2>
        <button
          onClick={() => {
            setShowForm((s) => !s);
            setMsg(null);
            setErr(null);
          }}
          className="rounded-xl bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black"
        >
          {showForm ? "Cerrar" : "+ Nuevo usuario"}
        </button>
      </div>
      <p className="mb-4 text-xs text-cica-muted">
        Control del equipo (administradores, operadores, técnicos y contabilidad) y sus accesos.
        Los clientes inician sesión con su documento y se gestionan en Clientes. {activos} de {usuarios.length} activos.
      </p>

      {msg && <div className="mb-3 rounded-lg border border-status-ftth/40 bg-status-ftth/10 px-3 py-2 text-xs text-status-ftth">{msg}</div>}
      {err && <div className="mb-3 rounded-lg border border-status-sin/40 bg-status-sin/10 px-3 py-2 text-xs text-status-sin">{err}</div>}

      {showForm && (
        <NuevoUsuarioForm
          onCreated={(u) => {
            setShowForm(false);
            setMsg(`Usuario ${u.username} creado (${u.idEmpleado}).`);
            refresh();
          }}
          onError={setErr}
        />
      )}

      <div className="glass overflow-hidden p-0">
        <table className="w-full text-xs">
          <thead className="bg-cica-navy/90 text-cica-muted">
            <tr>
              <th className="px-3 py-2 text-left">ID empleado</th>
              <th className="text-left">Nombre</th>
              <th className="text-left">Usuario</th>
              <th className="text-left">Rol</th>
              <th className="text-left">Estado</th>
              <th className="px-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className="border-t border-cica-border/30">
                <td className="px-3 py-2 font-mono text-cica-gold">{u.idEmpleado ?? "—"}</td>
                <td className="text-cica-silver">
                  {u.nombre}
                  {u.cargo ? <span className="block text-[10px] text-cica-muted">{u.cargo}</span> : null}
                  {u.email ? <span className="block text-[10px] text-cica-muted">{u.email}</span> : null}
                </td>
                <td className="text-cica-silver">{u.username}</td>
                <td>
                  <select
                    value={u.role}
                    onChange={(e) => cambiarRol(u, e.target.value)}
                    className="rounded-lg border border-cica-border bg-cica-navy/80 px-2 py-1 text-xs text-cica-silver outline-none focus:border-cica-gold"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={`text-[11px] font-semibold ${u.estado === "activo" ? "text-status-ftth" : "text-cica-muted"}`}>
                    {u.estado === "activo" ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="px-3 text-right">
                  <button onClick={() => resetPwd(u)} className="text-[11px] text-cica-steelLight hover:text-cica-gold">
                    Reset clave
                  </button>
                  <button
                    onClick={() => toggleEstado(u)}
                    disabled={u.id === currentUserId && u.role === "admin"}
                    className={`ml-3 text-[11px] disabled:opacity-30 ${u.estado === "activo" ? "text-cica-muted hover:text-status-sin" : "text-cica-muted hover:text-status-ftth"}`}
                  >
                    {u.estado === "activo" ? "Desactivar" : "Activar"}
                  </button>
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-cica-muted">Sin usuarios.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NuevoUsuarioForm({ onCreated, onError }: { onCreated: (u: Usuario) => void; onError: (m: string) => void }) {
  const [nombre, setNombre] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("tecnico");
  const [email, setEmail] = useState("");
  const [cargo, setCargo] = useState("");
  const [telefono, setTelefono] = useState("");
  const [idEmpleado, setIdEmpleado] = useState("");
  const [busy, setBusy] = useState(false);

  const valido = nombre.trim().length >= 2 && username.trim().length >= 3 && password.length >= 6;

  async function crear() {
    setBusy(true);
    try {
      const u = await crearUsuario({
        username: username.trim(),
        nombre: nombre.trim(),
        password,
        role,
        email: email.trim() || undefined,
        cargo: cargo.trim() || undefined,
        telefono: telefono.trim() || undefined,
        idEmpleado: idEmpleado.trim() || undefined,
      });
      onCreated(u);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass mb-4 p-4">
      <div className="mb-3 text-sm font-bold text-white">Nuevo usuario del staff</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre completo *"><input value={nombre} onChange={(e) => setNombre(e.target.value)} className={input} /></Field>
        <Field label="Usuario (login) *"><input value={username} onChange={(e) => setUsername(e.target.value)} className={input} placeholder="jperez" /></Field>
        <Field label="Contraseña inicial *"><input type="text" value={password} onChange={(e) => setPassword(e.target.value)} className={input} placeholder="mínimo 6 caracteres" /></Field>
        <Field label="Rol *">
          <select value={role} onChange={(e) => setRole(e.target.value)} className={input}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        <Field label="ID empleado (opcional)"><input value={idEmpleado} onChange={(e) => setIdEmpleado(e.target.value)} className={input} placeholder="auto: EMP-000X" /></Field>
        <Field label="Cargo"><input value={cargo} onChange={(e) => setCargo(e.target.value)} className={input} placeholder="Técnico de campo" /></Field>
        <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} className={input} /></Field>
        <Field label="Teléfono"><input value={telefono} onChange={(e) => setTelefono(e.target.value)} className={input} /></Field>
      </div>
      <div className="mt-3 flex justify-end">
        <button onClick={crear} disabled={!valido || busy} className="rounded-lg bg-gradient-to-r from-cica-amber to-cica-gold px-4 py-2 text-sm font-bold text-cica-black disabled:opacity-50">
          {busy ? "Creando…" : "Crear usuario"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-cica-muted">{label}</span>
      {children}
    </label>
  );
}
