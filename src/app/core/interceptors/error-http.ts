import { HttpErrorResponse } from '@angular/common/http';

interface RespuestaErrorBackend {
  mensaje?: string;
  message?: string;
  error?: string;
  detalle?: string;
}

export function extraerMensajeErrorHttp(
  error: unknown,
  mensajePorDefecto = 'Ocurrió un error inesperado al comunicarse con el servidor.',
): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'No hay conexión con el servidor. Verifica tu red o intenta más tarde.';
    }

    const cuerpo = error.error;
    if (cuerpo && typeof cuerpo === 'object') {
      const dto = cuerpo as RespuestaErrorBackend;
      const texto = dto.mensaje ?? dto.message ?? dto.detalle ?? dto.error;
      if (typeof texto === 'string' && texto.trim().length > 0) {
        return texto.trim();
      }
    }

    if (typeof cuerpo === 'string' && cuerpo.trim().length > 0) {
      return cuerpo.trim();
    }

    if (error.status === 401) {
      return 'Tu sesión expiró o no tienes autorización. Inicia sesión nuevamente.';
    }
    if (error.status === 403) {
      return 'No tienes permisos para realizar esta acción.';
    }
    if (error.status === 404) {
      return 'El recurso solicitado no existe.';
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return mensajePorDefecto;
}
