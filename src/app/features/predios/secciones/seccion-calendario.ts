import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { LOCALE, t } from '../../../core/i18n/idioma';
import { ClimaHistoricoService, HistoricoClima } from '../../../core/services/clima-historico.service';
import { Ayuda } from '../../../shared/components/ayuda';
import { Cargando } from '../../../shared/components/cargando';
import { TPipe } from '../../../shared/pipes/t.pipe';

interface Celda {
  mes: number; // 0 a 11
  valor: number | null;
  fondo: string;
  texto: string;
  titulo: string;
}

/**
 * Calendario del clima: mapa de calor de 12 meses con la lluvia y la temperatura normales (1991-2020) y la lluvia
 * de los últimos 12 meses, para ver de un vistazo la época de lluvias y los meses fríos al planear la siembra.
 * Usa el mismo histórico de Open-Meteo del panel «Clima histórico» (ya en memoria, sin otra consulta).
 */
@Component({
  selector: 'app-seccion-calendario',
  imports: [Ayuda, Cargando, DecimalPipe, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tarjeta' },
  template: `
    <div class="titulo-con-icono">
      <h3>{{ 'Calendario del clima' | t }}</h3>
      <app-ayuda [texto]="'Lluvia y temperatura normales de cada mes (promedio 1991-2020) y la lluvia de los últimos 12 meses. Sirve para elegir cuándo sembrar: color más intenso, más lluvia o más calor; azul, meses más fríos.' | t" />
    </div>
    @if (error()) {
      <p class="texto-suave">{{ error() }}</p>
    } @else if (!filas()) {
      <app-cargando [lineas]="3" />
    } @else {
      <div class="calendario" role="table" [attr.aria-label]="'Calendario del clima' | t">
        <div class="fila encabezado" role="row">
          <span role="columnheader"></span>
          @for (m of nombresMes; track $index) {
            <span role="columnheader" class="mes" [class.actual]="$index === mesActual">{{ m }}</span>
          }
        </div>
        @for (f of filas()!; track f.nombre) {
          <div class="fila" role="row">
            <span role="rowheader" class="nombre">{{ f.nombre | t }}<small>{{ f.unidad }}</small></span>
            @for (c of f.celdas; track c.mes) {
              <span role="cell" class="celda" [class.actual]="c.mes === mesActual" [style.background]="c.fondo"
                    [style.color]="c.texto" [attr.title]="c.titulo">{{ c.valor === null ? '—' : (c.valor | number: '1.0-0') }}</span>
            }
          </div>
        }
      </div>
      <p class="pie">
        <span><span class="muestra lluvia"></span>{{ 'Época de lluvias' | t }}: {{ epocaLluvias() }}</span>
        <span><span class="muestra frio"></span>{{ 'Meses más fríos' | t }}: {{ mesesFrios() }}</span>
      </p>
    }
  `,
  styles: `
    :host { display: block; }
    .titulo-con-icono { display: flex; align-items: center; gap: 6px; }
    .calendario { display: grid; gap: 4px; overflow-x: auto; }
    .fila { display: grid; grid-template-columns: minmax(96px, 1.3fr) repeat(12, minmax(30px, 1fr)); gap: 4px; align-items: center; }
    .mes { font-size: 0.75rem; text-align: center; color: var(--color-texto-suave); text-transform: capitalize; }
    .mes.actual { color: var(--color-texto); font-weight: 700; }
    .nombre { font-size: 0.82rem; line-height: 1.2; display: grid; }
    .nombre small { color: var(--color-texto-suave); font-size: 0.72rem; }
    .celda {
      height: 34px; border-radius: 6px; display: grid; place-items: center;
      font-size: 0.78rem; font-weight: 600; font-variant-numeric: tabular-nums; cursor: default;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .celda:hover { transform: scale(1.08); box-shadow: 0 4px 10px rgba(0, 0, 0, 0.12); }
    .celda.actual { outline: 2px solid var(--color-texto); outline-offset: 1px; }
    .pie { display: flex; flex-wrap: wrap; gap: 6px 20px; margin: 12px 0 0; font-size: 0.85rem; color: var(--color-texto-suave); }
    .pie > span { display: inline-flex; align-items: center; gap: 6px; }
    .muestra { width: 12px; height: 12px; border-radius: 3px; }
    .muestra.lluvia { background: var(--color-lluvia); }
    .muestra.frio { background: var(--color-frio); }
    @media (prefers-reduced-motion: reduce) { .celda { transition: none; } .celda:hover { transform: none; } }
  `,
})
export class SeccionCalendario implements OnInit {
  private readonly servicio = inject(ClimaHistoricoService);
  readonly latitud = input.required<number>();
  readonly longitud = input.required<number>();

  protected readonly datos = signal<HistoricoClima | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly mesActual = new Date().getMonth();

  private readonly formatoCorto = new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: 'UTC' });
  private readonly formatoLargo = new Intl.DateTimeFormat(LOCALE, { month: 'long', timeZone: 'UTC' });
  protected readonly nombresMes = Array.from({ length: 12 }, (_, i) =>
    this.formatoCorto.format(new Date(Date.UTC(2000, i, 1))).replace('.', ''));
  private nombreLargo = (i: number) => this.formatoLargo.format(new Date(Date.UTC(2000, i, 1)));

  /** Lluvia de los últimos 12 meses, ubicada en su mes del calendario. */
  private readonly lluviaReciente = computed(() => {
    const porMes: (number | null)[] = Array(12).fill(null);
    for (const m of this.datos()?.meses.slice(-12) ?? []) {
      porMes[m.mes - 1] = m.lluviaMm;
    }
    return porMes;
  });

  protected readonly filas = computed(() => {
    const d = this.datos();
    if (!d) {
      return null;
    }
    const maxLluvia = Math.max(1, ...d.normalLluvia, ...this.lluviaReciente().map((v) => v ?? 0));
    const temps = d.normalTemperatura;
    const media = temps.reduce((a, b) => a + b, 0) / 12;
    const rango = Math.max(0.5, ...temps.map((x) => Math.abs(x - media)));

    const celdaLluvia = (v: number | null, mes: number, etiqueta: string): Celda => {
      const pct = v === null ? 0 : Math.round(8 + (v / maxLluvia) * 82);
      return {
        mes, valor: v,
        fondo: v === null ? 'var(--color-superficie-2)' : `color-mix(in srgb, var(--color-lluvia) ${pct}%, var(--color-superficie))`,
        texto: pct > 55 ? '#FFFFFF' : 'var(--color-texto)',
        titulo: `${this.nombreLargo(mes)} · ${etiqueta}: ${v === null ? '—' : Math.round(v) + ' mm'}`,
      };
    };

    return [
      {
        nombre: 'Lluvia normal', unidad: 'mm',
        celdas: d.normalLluvia.map((v, i) => celdaLluvia(v, i, t('lluvia normal'))),
      },
      {
        nombre: 'Lluvia últimos 12 meses', unidad: 'mm',
        celdas: this.lluviaReciente().map((v, i) => celdaLluvia(v, i, t('lluvia reciente'))),
      },
      {
        nombre: 'Temperatura normal', unidad: '°C',
        celdas: temps.map((v, i): Celda => {
          const dif = (v - media) / rango; // -1 (más frío) a 1 (más cálido)
          const pct = Math.round(10 + Math.abs(dif) * 60);
          const tono = dif >= 0 ? '#C2492B' : 'var(--color-frio)';
          return {
            mes: i, valor: v,
            fondo: `color-mix(in srgb, ${tono} ${pct}%, var(--color-superficie))`,
            texto: pct > 50 ? '#FFFFFF' : 'var(--color-texto)',
            titulo: `${this.nombreLargo(i)} · ${t('temperatura normal')}: ${v.toFixed(1)} °C`,
          };
        }),
      },
    ];
  });

  /** Meses cuya lluvia normal supera el promedio mensual (la época de lluvias). */
  protected readonly epocaLluvias = computed(() => {
    const l = this.datos()?.normalLluvia ?? [];
    const prom = l.reduce((a, b) => a + b, 0) / (l.length || 1);
    return this.rango(l.map((v, i) => (v > prom ? i : -1)).filter((i) => i >= 0));
  });

  /** Los tres meses con la temperatura normal más baja. */
  protected readonly mesesFrios = computed(() => {
    const tm = this.datos()?.normalTemperatura ?? [];
    return this.rango(tm.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v).slice(0, 3).map((x) => x.i).sort((a, b) => a - b));
  });

  private rango(meses: number[]): string {
    return meses.length ? meses.map((i) => this.nombresMes[i]).join(', ') : '—';
  }

  ngOnInit(): void {
    this.servicio.obtener(this.latitud(), this.longitud()).subscribe({
      next: (d) => this.datos.set(d),
      error: () => this.error.set(t('No pudimos cargar el clima histórico de Open-Meteo. Vuelve a intentarlo en unos minutos.')),
    });
  }
}
