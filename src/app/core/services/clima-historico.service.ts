import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable, shareReplay } from 'rxjs';

/** Valores mensuales de un punto: clave "AAAA-MM". */
export interface Mes {
  clave: string;
  anio: number;
  mes: number; // 1 a 12
  lluviaMm: number;
  temperatura: number | null;
}

export interface HistoricoClima {
  meses: Mes[];
  /** Normal climática 1991-2020 por mes (índice 0 = enero). */
  normalLluvia: number[];
  normalTemperatura: number[];
}

/** Primer año del histórico y periodo de la normal climática (estándar de la OMM). */
const DESDE = 1991;
const NORMAL_DESDE = 1991;
const NORMAL_HASTA = 2020;

/**
 * Histórico diario de Open-Meteo (reanálisis ERA5, desde 1991) agrupado por mes, con la normal 1991-2020.
 * Se consulta directo desde el navegador (servicio público y gratuito, sin clave); solo se envían
 * las coordenadas del predio. El resultado se guarda en memoria para no repetir la descarga.
 */
@Injectable({ providedIn: 'root' })
export class ClimaHistoricoService {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, Observable<HistoricoClima>>();

  obtener(latitud: number, longitud: number): Observable<HistoricoClima> {
    const clave = `${latitud.toFixed(3)},${longitud.toFixed(3)}`;
    let consulta = this.cache.get(clave);
    if (!consulta) {
      // El reanálisis se publica con unos días de retraso.
      const hasta = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
      const url = 'https://archive-api.open-meteo.com/v1/archive'
        + `?latitude=${latitud}&longitude=${longitud}&start_date=${DESDE}-01-01&end_date=${hasta}`
        + '&daily=precipitation_sum,temperature_2m_mean&timezone=America%2FLima';
      consulta = this.http.get<RespuestaArchivo>(url).pipe(map(agrupar), shareReplay(1));
      this.cache.set(clave, consulta);
    }
    return consulta;
  }
}

interface RespuestaArchivo {
  daily: { time: string[]; precipitation_sum: (number | null)[]; temperature_2m_mean: (number | null)[] };
}

function agrupar(r: RespuestaArchivo): HistoricoClima {
  const porMes = new Map<string, { lluvia: number; temp: number; dias: number; total: number; anio: number; mes: number }>();
  r.daily.time.forEach((fecha, i) => {
    const clave = fecha.slice(0, 7);
    let m = porMes.get(clave);
    if (!m) {
      m = { lluvia: 0, temp: 0, dias: 0, total: 0, anio: +fecha.slice(0, 4), mes: +fecha.slice(5, 7) };
      porMes.set(clave, m);
    }
    m.total++;
    m.lluvia += r.daily.precipitation_sum[i] ?? 0;
    const t = r.daily.temperature_2m_mean[i];
    if (t !== null && t !== undefined) {
      m.temp += t;
      m.dias++;
    }
  });
  // Solo meses completos: el mes en curso (incompleto) falsearía la comparación con la normal.
  const meses: Mes[] = [...porMes.entries()]
    .filter(([, m]) => m.total >= new Date(Date.UTC(m.anio, m.mes, 0)).getUTCDate())
    .map(([clave, m]) => ({
    clave, anio: m.anio, mes: m.mes, lluviaMm: m.lluvia, temperatura: m.dias ? m.temp / m.dias : null,
  }));
  const normalLluvia: number[] = [];
  const normalTemperatura: number[] = [];
  for (let mes = 1; mes <= 12; mes++) {
    const base = meses.filter((m) => m.mes === mes && m.anio >= NORMAL_DESDE && m.anio <= NORMAL_HASTA);
    normalLluvia.push(promedio(base.map((m) => m.lluviaMm)));
    normalTemperatura.push(promedio(base.map((m) => m.temperatura).filter((t): t is number => t !== null)));
  }
  return { meses, normalLluvia, normalTemperatura };
}

function promedio(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}
