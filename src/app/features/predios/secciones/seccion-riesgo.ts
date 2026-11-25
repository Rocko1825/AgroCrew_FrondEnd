import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, of, Subject, switchMap } from 'rxjs';
import { DecimalPipe, LowerCasePipe } from '@angular/common';
import { t } from '../../../core/i18n/idioma';
import { etiqueta } from '../../../core/models/etiquetas';
import { mensajeError } from '../../../core/interceptors/auth.interceptor';
import { NivelRiesgo, PuntoCritico, Predio, Riesgo } from '../../../core/models/api.models';
import { PredioService } from '../../../core/services/predio.service';
import { ReporteService } from '../../../core/services/reporte.service';
import { Aviso } from '../../../shared/components/aviso';
import { Cargando } from '../../../shared/components/cargando';
import { COLOR_NIVEL, Mapa, MarcadorMapa, VistaMapa } from '../../../shared/components/mapa';
import { EtiquetaPipe } from '../../../shared/pipes/etiqueta.pipe';
import { TPipe } from '../../../shared/pipes/t.pipe';

/**
 * Riesgo hídrico del predio (US14, T87): nivel de bajo a muy alto, tipo de peligro y distancia
 * del punto crítico de la ANA más cercano, con un mapa pequeño.
 */
@Component({
  selector: 'app-seccion-riesgo',
  imports: [Aviso, Cargando, DecimalPipe, LowerCasePipe, EtiquetaPipe, Mapa, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tarjeta' },
  template: `
    <div class="titulo-con-icono">
      <h3>{{ 'Riesgo hídrico' | t }}</h3>
    </div>
    @if (error()) {
      <app-aviso tipo="advertencia">{{ error() }}</app-aviso>
    } @else if (!riesgo()) {
      <app-cargando [texto]="'Consultando los puntos críticos de la ANA…' | t" [lineas]="4" />
    } @else {
      @if (riesgo(); as r) {
        <!-- Medidor tipo velocímetro: la aguja apunta al nivel de riesgo del predio. -->
        <figure class="medidor" role="img" [attr.aria-label]="('Nivel de riesgo' | t) + ': ' + (r.nivelRiesgo | etiqueta)">
          <svg viewBox="0 0 200 116" aria-hidden="true">
            @for (seg of segmentos; track seg.nivel) {
              <path [attr.d]="seg.d" [attr.stroke]="colores[seg.nivel]" class="segmento" [class.activo]="seg.nivel === r.nivelRiesgo" />
            }
            <g class="aguja" [style.--giro]="giroAguja() + 'deg'">
              <path d="M100 100 L97 100 L100 30 L103 100 Z" />
            </g>
            <circle cx="100" cy="100" r="7" class="eje" />
          </svg>
          <figcaption>
            <span class="nivel-texto" [style.color]="colores[r.nivelRiesgo]">{{ 'Riesgo' | t }} {{ r.nivelRiesgo | etiqueta | lowercase }}</span>
            <span class="extremos"><span>{{ 'Bajo' | t }}</span><span>{{ 'Muy alto' | t }}</span></span>
          </figcaption>
        </figure>
        <!-- Dato corto en vez de la frase del backend: el nivel ya lo dice el medidor y la distancia, la ficha. -->
        @if (r.puntosCercanos.length) {
          <p class="resumen-riesgo">{{ '{n} puntos críticos a menos de {km} km' | t: { n: r.puntosCercanos.length, km: r.radioKm } }}</p>
        }
        @if (r.puntoMasCercano; as p) {
          <dl class="detalle">
            <dt>{{ 'Punto más cercano' | t }}</dt><dd>{{ p.distanciaKm | number: '1.1-1' }} km</dd>
            <dt>{{ 'Tipo de peligro' | t }}</dt><dd>{{ p.tipoPeligro || ('No especificado' | t) }}</dd>
          </dl>
          @if (p.descripcion) { <p class="descripcion">{{ p.descripcion }}</p> }
        } @else {
          <app-aviso tipo="exito">{{ 'No hay puntos críticos de la ANA a menos de {km} km de tu predio.' | t: { km: r.radioKm } }}</app-aviso>
        }
        @if (predio()) {
          <!-- Dona: puntos críticos de la zona que se ve en el mapa; cambia al acercar, alejar o mover el mapa. -->
          <div class="dona-bloque">
            <p class="subtitulo">{{ 'Puntos críticos en la zona del mapa' | t }}<span class="radio">{{ '≈ {km} km a la redonda' | t: { km: radioVista() } }}</span>@if (buscando()) { <span class="buscando" aria-hidden="true"></span> }</p>
            @if (!puntosVisibles().length) {
              <p class="pista-filtro">{{ 'No hay puntos críticos en esta zona. Aleja el mapa para ver más.' | t }}</p>
            } @else {
            <div class="dona-fila">
              <svg class="dona" viewBox="0 0 42 42" role="img" [attr.aria-label]="'Puntos críticos por nivel' | t">
                <circle cx="21" cy="21" r="15.9155" class="dona-pista" />
                @for (s of porNivel(); track s.nivel) {
                  <circle cx="21" cy="21" r="15.9155" class="dona-arco" [attr.stroke]="colores[s.nivel]"
                          [attr.stroke-dasharray]="s.pct + ' ' + (100 - s.pct)" [attr.stroke-dashoffset]="s.desfase"
                          [class.tenue]="filtro() && filtro() !== s.nivel" (click)="alternarFiltro(s.nivel)" />
                }
                <text x="21" y="22" class="dona-total">{{ filtro() ? cantidadFiltro() : puntosVisibles().length }}</text>
                <text x="21" y="27.5" class="dona-etiqueta">{{ filtro() ? (filtro()! | etiqueta | lowercase) : ('puntos' | t) }}</text>
              </svg>
              <ul class="dona-leyenda">
                @for (s of porNivel(); track s.nivel) {
                  <li>
                    <button type="button" [class.activo]="filtro() === s.nivel" [attr.aria-pressed]="filtro() === s.nivel"
                            (click)="alternarFiltro(s.nivel)">
                      <span class="punto" [style.background]="colores[s.nivel]"></span>
                      <span class="nombre">{{ s.nivel | etiqueta }}</span>
                      <strong>{{ s.cantidad }}</strong>
                    </button>
                  </li>
                }
              </ul>
            </div>
            <p class="pista-filtro">{{ (filtro() ? 'Pulsa de nuevo para ver todos los puntos.' : 'Pulsa un nivel para verlo en el mapa; acerca o aleja el mapa para cambiar la zona.') | t }}</p>
              @if (radioVista() >= 50) { <p class="pista-filtro">{{ 'Se muestran como máximo 50 km a la redonda.' | t }}</p> }
            }
          </div>
        }
        @if (predio()) {
          @defer (on viewport) {
            <app-mapa class="mapa-riesgo" [marcadores]="marcadores()" [ajustar]="true" alto="220px" (movido)="vista$.next($event)"
                      [etiqueta]="'Mapa del predio y los puntos críticos cercanos' | t" />
          } @placeholder {
            <div class="esqueleto" style="height: 220px; border-radius: var(--radio-tarjeta)"></div>
          }
        }
      }
    }
  `,
  styles: `
    :host { display: block; }
    .medidor { margin: 0 auto 8px; max-width: 240px; text-align: center; }
    .medidor svg { display: block; width: 100%; height: auto; overflow: visible; }
    .segmento { fill: none; stroke-width: 16; opacity: 0.35; transition: opacity 0.4s ease; }
    .segmento.activo { opacity: 1; }
    .aguja { transform-origin: 100px 100px; transform: rotate(var(--giro)); animation: girar 1.2s var(--curva) both; }
    .aguja path { fill: var(--color-texto); }
    .eje { fill: var(--color-texto); stroke: var(--color-superficie); stroke-width: 3; }
    @keyframes girar { from { transform: rotate(-90deg); } }
    figcaption { display: grid; gap: 2px; margin-top: 2px; }
    .nivel-texto { font-size: 1.15rem; font-weight: 800; }
    .extremos { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--color-texto-suave); padding: 0 6px; }

    .dona-bloque { margin: 14px 0 4px; padding-top: 14px; border-top: 1px solid var(--color-borde); }
    .subtitulo { font-weight: 600; margin: 0 0 10px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
    .radio { font-weight: 400; font-size: 0.8rem; color: var(--color-texto-suave); }
    .buscando { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--color-acento); border-right-color: transparent; animation: girar-carga 0.8s linear infinite; align-self: center; }
    @keyframes girar-carga { to { transform: rotate(360deg); } }
    .dona-fila { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .dona { width: 120px; height: 120px; flex: none; }
    .dona-pista { fill: none; stroke: var(--color-pista); stroke-width: 5; }
    .dona-arco { fill: none; stroke-width: 5; cursor: pointer; transition: opacity 0.25s ease, stroke-width 0.25s ease; animation: aparecer 0.8s ease both; }
    .dona-arco:hover { stroke-width: 6.5; }
    .dona-arco.tenue { opacity: 0.2; }
    .dona-total { font-size: 9px; font-weight: 800; text-anchor: middle; fill: var(--color-texto); }
    .dona-etiqueta { font-size: 3.6px; text-anchor: middle; fill: var(--color-texto-suave); }
    .dona-leyenda { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; flex: 1 1 110px; }
    .dona-leyenda button {
      width: 100%; display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 8px;
      border: 1px solid transparent; background: none; font: inherit; font-size: 0.9rem; color: var(--color-texto); cursor: pointer;
    }
    .dona-leyenda button:hover { background: var(--color-superficie-2); }
    .dona-leyenda button.activo { border-color: var(--color-borde); background: var(--color-superficie-2); }
    .dona-leyenda .nombre { flex: 1; text-align: left; }
    .punto { width: 10px; height: 10px; border-radius: 50%; flex: none; }
    .pista-filtro { font-size: 0.8rem; color: var(--color-texto-suave); margin: 8px 0 0; }
    @media (prefers-reduced-motion: reduce) { .aguja, .dona-arco { animation: none; } }
    .detalle { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0 0 12px; font-size: 0.9rem; }
    .detalle dt { color: var(--color-texto-suave); }
    .detalle dd { margin: 0; }
    .resumen-riesgo { text-align: center; font-weight: 600; margin: 0 0 12px; font-variant-numeric: tabular-nums; }
    .descripcion { font-size: 0.9rem; padding: 10px 12px; border-radius: 8px; background: var(--color-superficie-2); border-left: 3px solid var(--color-borde); }
    .mapa-riesgo { display: block; margin-top: 12px; }
  `,
})
export class SeccionRiesgo implements OnInit {
  private readonly predios = inject(PredioService);
  private readonly reportes = inject(ReporteService);
  private readonly destroyRef = inject(DestroyRef);
  readonly predioId = input.required<number>();
  readonly predio = input<Predio | null>(null);

  protected readonly niveles = ['BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO'] as const;
  /** Nivel elegido en la dona para filtrar el mapa (null = todos). */
  protected readonly filtro = signal<NivelRiesgo | null>(null);

  /** Zona que se ve en el minimapa: al moverlo, se consultan los puntos críticos de esa zona. */
  protected readonly vista$ = new Subject<VistaMapa>();
  private readonly puntosZona = signal<PuntoCritico[] | null>(null);
  protected readonly radioVista = signal(5);
  protected readonly buscando = signal(false);
  /** Puntos de la zona visible; mientras no se mueve el mapa, los que están a 5 km del predio. */
  protected readonly puntosVisibles = computed(() => this.puntosZona() ?? this.riesgo()?.puntosCercanos ?? []);

  /** Cuatro arcos del velocímetro (de 180° a 0°), uno por nivel, con un pequeño espacio entre ellos. */
  protected readonly segmentos = this.niveles.map((nivel, i) => {
    const punto = (grados: number) => {
      const rad = (grados * Math.PI) / 180;
      return `${(100 + 80 * Math.cos(rad)).toFixed(2)} ${(100 - 80 * Math.sin(rad)).toFixed(2)}`;
    };
    const inicio = 180 - i * 45 - 1.5;
    const fin = 180 - (i + 1) * 45 + 1.5;
    return { nivel, d: `M ${punto(inicio)} A 80 80 0 0 1 ${punto(fin)}` };
  });

  /** Giro de la aguja: -90° (izquierda) a 90° (derecha), al centro del arco del nivel. */
  protected readonly giroAguja = computed(() => {
    const i = this.niveles.indexOf(this.riesgo()?.nivelRiesgo ?? 'BAJO');
    return -90 + 22.5 + 45 * i;
  });

  /** Porción de la dona por nivel (en % de 100) y su desfase para dibujarla desde arriba. */
  protected readonly porNivel = computed(() => {
    const puntos = this.puntosVisibles();
    let acumulado = 0;
    return [...this.niveles].reverse()
      .map((nivel) => ({ nivel, cantidad: puntos.filter((p) => p.nivelRiesgo === nivel).length }))
      .filter((n) => n.cantidad > 0)
      .map((n) => {
        const pct = (n.cantidad / puntos.length) * 100;
        const segmento = { ...n, pct, desfase: 25 - acumulado };
        acumulado += pct;
        return segmento;
      });
  });
  protected readonly cantidadFiltro = computed(() => this.porNivel().find((n) => n.nivel === this.filtro())?.cantidad ?? 0);

  protected alternarFiltro(nivel: NivelRiesgo): void {
    this.filtro.update((f) => (f === nivel ? null : nivel));
  }
  protected readonly colores = COLOR_NIVEL;
  protected readonly riesgo = signal<Riesgo | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly marcadores = computed<MarcadorMapa[]>(() => {
    const p = this.predio();
    const r = this.riesgo();
    const f = this.filtro();
    const lista: MarcadorMapa[] = this.puntosVisibles().filter((pc) => !f || pc.nivelRiesgo === f).map((pc) => ({
      latitud: pc.latitud,
      longitud: pc.longitud,
      color: COLOR_NIVEL[pc.nivelRiesgo],
      radio: 7,
      titulo: `${pc.tipoPeligro ?? t('Punto crítico')} · ${t('riesgo')} ${etiqueta(pc.nivelRiesgo).toLowerCase()}`,
      popup: `${pc.descripcion}\n${t('Distancia')}: ${pc.distanciaKm?.toFixed(1) ?? '—'} km`,
    }));
    if (p) {
      lista.push({ latitud: p.latitud, longitud: p.longitud, color: '#2F5D3A', radio: 10, titulo: p.nombre });
    }
    return lista;
  });

  ngOnInit(): void {
    this.vista$.pipe(
      debounceTime(450),
      switchMap((v) => {
        this.buscando.set(true);
        this.radioVista.set(Math.round(v.radioKm));
        return this.reportes.puntosCriticos(v.latitud, v.longitud, v.radioKm).pipe(catchError(() => of(null)));
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((lista) => {
      this.buscando.set(false);
      if (lista) {
        this.puntosZona.set(lista);
        // Si el nivel filtrado ya no está en la zona, se vuelve a mostrar todo.
        const f = this.filtro();
        if (f && !lista.some((p) => p.nivelRiesgo === f)) {
          this.filtro.set(null);
        }
      }
    });

    this.predios.riesgo(this.predioId()).subscribe({
      next: (r) => this.riesgo.set(r),
      error: (e) => this.error.set(mensajeError(e)),
    });
  }
}
