import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { LOCALE, t } from '../../../core/i18n/idioma';
import { ClimaHistoricoService, HistoricoClima, Mes } from '../../../core/services/clima-historico.service';
import { Aviso } from '../../../shared/components/aviso';
import { Cargando } from '../../../shared/components/cargando';
import { Contador } from '../../../shared/components/contador';
import { Grafico, SerieGrafico } from '../../../shared/components/grafico';
import { Ayuda } from '../../../shared/components/ayuda';
import { Icono } from '../../../shared/components/icono';
import { TPipe } from '../../../shared/pipes/t.pipe';

type Vista = 'lluvia' | 'temperatura' | 'nino';

/** Años de El Niño costero reconocidos por el ENFEN (referencia para marcar el gráfico anual). */
const ANIOS_NINO: Record<number, string> = {
  1997: 'El Niño extraordinario 1997-98',
  1998: 'El Niño extraordinario 1997-98',
  2017: 'El Niño costero 2017',
  2023: 'El Niño costero 2023',
};

const CALIDO = '#C2492B';
const FRIO = 'var(--color-frio)';
const NEUTRO = '#9AA79E';
const NINO = '#6E120D';

/**
 * Clima histórico del predio (desde 1991, Open-Meteo / ERA5): indicadores rápidos y tres vistas
 * interactivas — lluvia de los últimos 12 meses frente a lo normal, temperatura frente a lo normal y
 * la historia anual con los años de El Niño costero marcados. Todo se calcula en el navegador.
 */
@Component({
  selector: 'app-seccion-historico',
  imports: [Aviso, Ayuda, Cargando, Contador, DecimalPipe, Grafico, Icono, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="cabeza">
      <div>
        <h2 id="titulo-historico">{{ 'Clima histórico y El Niño' | t }}</h2>
        <p>{{ 'Cómo se ha comportado el clima de tu predio desde 1991 y cómo está hoy frente a lo normal.' | t }}</p>
      </div>
    </header>

    @if (error()) {
      <app-aviso tipo="advertencia">{{ error() }}</app-aviso>
    } @else if (!datos()) {
      <div class="indicadores">
        @for (i of [1, 2, 3, 4]; track i) { <div class="indicador"><app-cargando [lineas]="2" /></div> }
      </div>
      <div class="panel-grafico"><app-cargando [texto]="'Analizando 35 años de clima de tu zona…' | t" [lineas]="5" /></div>
    } @else {
      <div class="indicadores">
        <div class="indicador lluvia">
          <span class="etiqueta"><app-icono nombre="gota" [tamano]="16" /> {{ 'Lluvia en los últimos 12 meses' | t }}</span>
          <span class="valor" [appContador]="resumen().lluvia12" sufijo=" mm"></span>
          <span class="nota" [class.alto]="resumen().lluviaPct > 120" [class.bajo]="resumen().lluviaPct < 80">
            {{ '{pct}% de lo normal' | t: { pct: resumen().lluviaPct } }}
          </span>
        </div>
        <div class="indicador temperatura" [class.calido]="resumen().anomalia3 >= 0.5" [class.frio]="resumen().anomalia3 <= -0.5">
          <span class="etiqueta"><app-icono nombre="termometro" [tamano]="16" /> {{ 'Temperatura de los últimos 3 meses' | t }}</span>
          <span class="valor">{{ resumen().anomalia3 > 0 ? '+' : '' }}{{ resumen().anomalia3 | number: '1.1-1' }} °C</span>
          <span class="nota">{{ estadoTermico() | t }} · {{ 'vs. 1991-2020' | t }}
            <app-ayuda [texto]="'Diferencia entre la temperatura media de los últimos 3 meses y lo normal para esos meses (promedio 1991-2020). Desde +1 °C es una condición cálida como la de los años de El Niño.' | t" /></span>
        </div>
        <div class="indicador mes">
          <span class="etiqueta"><app-icono nombre="calendario" [tamano]="16" /> {{ 'Mes más lluvioso del año' | t }}</span>
          <span class="valor capital">{{ resumen().mesLluvioso }}</span>
          <span class="nota">{{ '{mm} mm en promedio' | t: { mm: resumen().mesLluviosoMm } }}</span>
        </div>
        <div class="indicador record">
          <span class="etiqueta"><app-icono nombre="sol" [tamano]="16" /> {{ 'Año más cálido desde 1991' | t }}</span>
          <span class="valor">{{ resumen().anioCalido }}@if (resumen().anioCalidoParcial) { <span class="parcial">{{ 'parcial' | t }}</span> }</span>
          <span class="nota">+{{ resumen().anioCalidoAnomalia | number: '1.1-1' }} °C {{ 'sobre lo normal' | t }}</span>
        </div>
      </div>

      <div class="panel-grafico">
        <div class="barra">
          <div class="pestanas" role="tablist" [attr.aria-label]="'Vistas del clima histórico' | t">
            @for (v of vistas; track v.id) {
              <button type="button" role="tab" [attr.aria-selected]="vista() === v.id" (click)="vista.set(v.id)">{{ v.texto | t }}</button>
            }
          </div>
          <app-ayuda class="ayuda-vista" [texto]="explicacionVista() | t" />
          @if (vista() === 'temperatura') {
            <div class="periodos" role="group" [attr.aria-label]="'Periodo' | t">
              @for (n of [12, 24, 36]; track n) {
                <button type="button" class="chip-periodo" [class.activo]="periodo() === n" [attr.aria-pressed]="periodo() === n"
                        (click)="periodo.set(n)">{{ '{n} meses' | t: { n } }}</button>
              }
            </div>
          }
        </div>

        @switch (vista()) {
          @case ('lluvia') {
            <app-grafico tipo="combinado" [etiquetas]="etiquetasLluvia()" [series]="seriesLluvia()" alto="300px"
                         [descripcion]="'Lluvia mensual de los últimos 12 meses frente a lo normal' | t" />
          }
          @case ('temperatura') {
            <app-grafico [etiquetas]="etiquetasAnomalia()" [series]="seriesAnomalia()" alto="300px" [mostrarLeyenda]="false"
                         [descripcion]="'Anomalía de temperatura mensual' | t" />
          }
          @case ('nino') {
            <app-grafico [etiquetas]="etiquetasAnual()" [series]="seriesAnual()" [detalles]="detallesAnual()" alto="300px"
                         [mostrarLeyenda]="false" [descripcion]="'Anomalía de temperatura anual desde 1991' | t" />
            <ul class="leyenda-nino">
              <li><span class="punto" [style.background]="calido"></span>{{ 'Año más cálido de lo normal' | t }}</li>
              <li><span class="punto" [style.background]="frio"></span>{{ 'Año más frío de lo normal' | t }}</li>
              <li><span class="punto nino"></span>{{ 'Año de El Niño costero (ENFEN)' | t }}</li>
            </ul>
          }
        }
        <p class="fuente">{{ 'Fuente: Open-Meteo (reanálisis ERA5). Datos referenciales; para alertas oficiales de El Niño consulta al ENFEN.' | t }}</p>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .cabeza { margin-bottom: 18px; }
    .cabeza h2 { margin-bottom: 4px; }
    .cabeza p { margin: 0; color: var(--color-texto-suave); }

    .indicadores { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
    /* Cada indicador define su --tono: la franja superior y un degradado suave del mismo color (sirve en claro y oscuro). */
    .indicador {
      --tono: var(--color-acento);
      display: grid; gap: 4px; align-content: start; padding: 18px 20px; border-radius: var(--radio-tarjeta);
      border: 1px solid var(--color-borde); border-top: 4px solid var(--tono);
      background: linear-gradient(180deg, color-mix(in srgb, var(--tono) 14%, var(--color-superficie)), var(--color-superficie) 72%);
      transition: transform 0.25s var(--curva), box-shadow 0.25s ease;
    }
    .indicador:hover {
      transform: translateY(-3px);
      box-shadow: 0 10px 24px color-mix(in srgb, var(--tono) 22%, transparent);
    }
    .indicador.lluvia { --tono: var(--color-lluvia); }
    .indicador.temperatura { --tono: #9AA79E; }
    .indicador.temperatura.calido { --tono: #C2492B; }
    .indicador.temperatura.frio { --tono: var(--color-frio); }
    .indicador.mes { --tono: #C9A66B; }
    .indicador.record { --tono: #A1231A; }
    .etiqueta { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--color-texto-suave); }
    .valor { font-size: 1.7rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; }
    .capital { text-transform: capitalize; }
    .nota { font-size: 0.85rem; color: var(--color-texto-suave); }
    .nota.alto { color: var(--color-lluvia); font-weight: 600; }
    .nota.bajo { color: #B98900; font-weight: 600; }

    .panel-grafico {
      padding: 20px 22px; border-radius: var(--radio-tarjeta);
      background: var(--color-superficie); border: 1px solid var(--color-borde);
    }
    .barra { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .pestanas {
      display: inline-flex; gap: 4px; padding: 4px; border-radius: 10px;
      background: var(--color-superficie-2); border: 1px solid var(--color-borde);
    }
    .pestanas button {
      border: none; background: none; font: inherit; font-weight: 600; font-size: 0.9rem; cursor: pointer;
      padding: 8px 14px; border-radius: 7px; color: var(--color-texto-suave); transition: background-color 0.2s ease, color 0.2s ease;
    }
    .pestanas button[aria-selected='true'] { background: var(--color-marca); color: #FFFFFF; }
    .pestanas button:not([aria-selected='true']):hover { color: var(--color-texto); }
    .periodos { display: inline-flex; gap: 6px; }
    .chip-periodo {
      font: inherit; font-size: 0.85rem; cursor: pointer; padding: 5px 12px; border-radius: 999px;
      border: 1px solid var(--color-borde); background: var(--color-superficie); color: var(--color-texto-suave);
    }
    .chip-periodo.activo { border-color: var(--color-acento); background: var(--color-marca-claro); color: var(--color-texto); font-weight: 600; }
    .ayuda-vista { margin-right: auto; }
    .parcial { font-size: 0.75rem; font-weight: 600; letter-spacing: 0; margin-left: 8px; padding: 2px 8px; border-radius: 999px;
      vertical-align: middle; color: var(--color-texto-suave); border: 1px dashed var(--color-borde); }
    .leyenda-nino { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 0; margin: 10px 0 0; font-size: 0.85rem; }
    .leyenda-nino li { display: inline-flex; align-items: center; gap: 6px; }
    .punto { width: 12px; height: 12px; border-radius: 3px; }
    .punto.nino { background: #6E120D; }
    .fuente { font-size: 0.8rem; color: var(--color-texto-suave); margin: 14px 0 0; }

    @media (max-width: 1000px) { .indicadores { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 520px) { .indicadores { grid-template-columns: 1fr; } .pestanas { flex-wrap: wrap; } }
    @media (prefers-reduced-motion: reduce) { .indicador { transition: none; } .indicador:hover { transform: none; } }
  `,
})
export class SeccionHistorico implements OnInit {
  private readonly servicio = inject(ClimaHistoricoService);
  readonly latitud = input.required<number>();
  readonly longitud = input.required<number>();

  protected readonly datos = signal<HistoricoClima | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly vista = signal<Vista>('lluvia');
  protected readonly periodo = signal(24);
  protected readonly calido = CALIDO;
  protected readonly frio = FRIO;
  protected readonly vistas: { id: Vista; texto: string }[] = [
    { id: 'lluvia', texto: 'Lluvia vs. lo normal' },
    { id: 'temperatura', texto: 'Temperatura vs. lo normal' },
    { id: 'nino', texto: 'Historia y El Niño' },
  ];

  private readonly formatoMes = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  private readonly formatoMesLargo = new Intl.DateTimeFormat(LOCALE, { month: 'long', timeZone: 'UTC' });
  private etiquetaMes = (m: Mes) => this.formatoMes.format(new Date(Date.UTC(m.anio, m.mes - 1, 1)));

  /** Diferencia de temperatura de cada mes frente a su normal. */
  private readonly anomalias = computed(() => {
    const d = this.datos();
    if (!d) {
      return [];
    }
    return d.meses
      .filter((m) => m.temperatura !== null)
      .map((m) => ({ mes: m, valor: (m.temperatura as number) - d.normalTemperatura[m.mes - 1] }));
  });

  /** Promedio anual de las anomalías mensuales (vale también para el año en curso, aunque esté incompleto). */
  private readonly anual = computed(() => {
    const porAnio = new Map<number, number[]>();
    for (const a of this.anomalias()) {
      porAnio.set(a.mes.anio, [...(porAnio.get(a.mes.anio) ?? []), a.valor]);
    }
    return [...porAnio.entries()].map(([anio, v]) => ({ anio, valor: v.reduce((x, y) => x + y, 0) / v.length }));
  });

  protected readonly resumen = computed(() => {
    const d = this.datos()!;
    const ultimos12 = d.meses.slice(-12);
    const lluvia12 = Math.round(ultimos12.reduce((s, m) => s + m.lluviaMm, 0));
    const normal12 = ultimos12.reduce((s, m) => s + d.normalLluvia[m.mes - 1], 0);
    const ult3 = this.anomalias().slice(-3);
    const anomalia3 = ult3.length ? ult3.reduce((s, a) => s + a.valor, 0) / ult3.length : 0;
    const iMes = d.normalLluvia.indexOf(Math.max(...d.normalLluvia));
    const record = this.anual().reduce((a, b) => (b.valor > a.valor ? b : a), { anio: 0, valor: -Infinity });
    return {
      lluvia12,
      lluviaPct: normal12 > 0 ? Math.round((lluvia12 / normal12) * 100) : 100,
      anomalia3: Math.round(anomalia3 * 10) / 10,
      mesLluvioso: this.formatoMesLargo.format(new Date(Date.UTC(2000, iMes, 1))),
      mesLluviosoMm: Math.round(d.normalLluvia[iMes]),
      anioCalido: record.anio,
      anioCalidoParcial: record.anio === this.anioParcial(),
      anioCalidoAnomalia: record.valor,
    };
  });

  /** Año en curso si todavía no tiene sus 12 meses (su promedio es parcial). */
  protected readonly anioParcial = computed(() => {
    const meses = this.datos()?.meses ?? [];
    const ultimo = meses[meses.length - 1];
    return ultimo && ultimo.mes < 12 ? ultimo.anio : null;
  });

  protected readonly explicacionVista = computed(() => ({
    lluvia: 'Barras: lluvia de cada mes. Línea: lo normal para ese mes (promedio 1991-2020).',
    temperatura: 'Diferencia de la temperatura de cada mes frente a lo normal. Rojo: más cálido; azul: más frío.',
    nino: 'Temperatura de cada año frente a lo normal. Los años de El Niño costero suelen ser los más cálidos en la costa; pasa el cursor para verlos.',
  })[this.vista()]);

  protected readonly estadoTermico = computed(() => {
    const a = this.resumen().anomalia3;
    if (a >= 1) return 'Muy cálido';
    if (a >= 0.5) return 'Cálido';
    if (a <= -0.5) return 'Frío';
    return 'Normal';
  });

  // ---------- Vista: lluvia de los últimos 12 meses frente a la normal ----------
  protected readonly etiquetasLluvia = computed(() => (this.datos()?.meses.slice(-12) ?? []).map(this.etiquetaMes));
  protected readonly seriesLluvia = computed<SerieGrafico[]>(() => {
    const d = this.datos();
    const meses = d?.meses.slice(-12) ?? [];
    return [
      { nombre: t('Lluvia del mes'), datos: meses.map((m) => round1(m.lluviaMm)), color: 'var(--color-lluvia)', eje: 'y', unidad: ' mm' },
      { nombre: t('Lo normal'), datos: meses.map((m) => round1(d!.normalLluvia[m.mes - 1])), color: '#C9A66B', tipo: 'line', eje: 'y', unidad: ' mm' },
    ];
  });

  // ---------- Vista: anomalía mensual de temperatura ----------
  private readonly anomaliasPeriodo = computed(() => this.anomalias().slice(-this.periodo()));
  protected readonly etiquetasAnomalia = computed(() => this.anomaliasPeriodo().map((a) => this.etiquetaMes(a.mes)));
  protected readonly seriesAnomalia = computed<SerieGrafico[]>(() => {
    const v = this.anomaliasPeriodo().map((a) => round1(a.valor));
    return [{ nombre: t('Diferencia con lo normal'), datos: v, color: v.map(colorAnomalia), unidad: ' °C' }];
  });

  // ---------- Vista: historia anual y El Niño ----------
  protected readonly etiquetasAnual = computed(() => this.anual().map((a) => String(a.anio)));
  protected readonly seriesAnual = computed<SerieGrafico[]>(() => {
    const anual = this.anual();
    return [{
      nombre: t('Diferencia con lo normal'),
      datos: anual.map((a) => round1(a.valor)),
      color: anual.map((a) => (ANIOS_NINO[a.anio] ? NINO : colorAnomalia(a.valor))),
      unidad: ' °C',
    }];
  });
  protected readonly detallesAnual = computed(() => this.anual().map((a) => [
    ANIOS_NINO[a.anio] ? t(ANIOS_NINO[a.anio]) : '',
    a.anio === this.anioParcial() ? t('Año en curso: promedio parcial') : '',
  ].filter(Boolean).join(' · ')));

  ngOnInit(): void {
    this.servicio.obtener(this.latitud(), this.longitud()).subscribe({
      next: (d) => (d.meses.length >= 24 ? this.datos.set(d) : this.error.set(t('No hay suficientes datos históricos para tu zona.'))),
      error: () => this.error.set(t('No pudimos cargar el clima histórico de Open-Meteo. Vuelve a intentarlo en unos minutos.')),
    });
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function colorAnomalia(v: number | null): string {
  if (v === null || Math.abs(v) < 0.15) return NEUTRO;
  return v > 0 ? CALIDO : FRIO;
}
