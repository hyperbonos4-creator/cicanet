import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Gate de autenticación: ninguna ruta es pública salvo /login y assets.
 * Si no hay token en cookie, redirige a /login.
 */
export function middleware(req: NextRequest) {
  const token = req.cookies.get("cica_token")?.value;
  const { pathname } = req.nextUrl;

  const isLogin = pathname.startsWith("/login");

  if (!token && !isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // Si ya hay sesión y va a /login, mándalo al mapa.
  if (token && isLogin) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Protege todo menos assets de Next, los logos, y el proxy de API/WebSocket.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|vx-emblem.svg|visionyx-logo.png|cicanet-logo.png|api|socket.io).*)"],
};
