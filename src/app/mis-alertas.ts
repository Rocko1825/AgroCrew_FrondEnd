import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { LOCALE, t } from '../../core/i18n/idioma';
import { mensajeError } from '../../core/interceptors/auth.interceptor';
import { Alerta, NivelRiesgo } from '../../core/models/api.models';
import { AlertaService } from '../../core/services/alerta.service';
import { ConfirmacionService } from '../../core/services/confirmacion.service';
import { NotificacionService } from '../../core/services/notificacion.service';
import { Aviso } from '../../shared/components/aviso';
import { Cargando } from '../../shared/components/cargando';
import { EstadoVacio } from '../../shared/components/estado-vacio';
import { etiqueta } from '../../core/models/etiquetas';
import { EtiquetaPipe } from '../../shared/pipes/etiqueta.pipe';
import { Icono } from '../../shared/components/icono';
import { TApiPipe, TPipe } from '../../shared/pipes/t.pipe';

type FiltroEstado = 'todas' | 'no-leidas' | 'leidas';

interface DiaActividad {
  clave: string;
  fecha: Date;
  n: number;
  /** 0–4: intensidad del cuadro. */
  escala: number;
}

const DIA = 86_400_000;
const DIAS_ACTIVIDAD = 30;
/** Alto fijo de cada fila de la lista virtual (px). */
export const ALTO_FILA = 72;
const NIVELES: NivelRiesgo[] = ['MUY_ALTO', 'ALTO', 'MEDIO', 'BAJO'];

/** Clave AAAA-MM-DD en hora local. */
function claveDia(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

/**
 * Centro de alertas (US15, US16; T89–T91). Arriba, un resumen que también filtra: anillo de no leídas,
 * chips por nivel, el predio con más alertas y la actividad real de los últimos 30 días. Debajo, una bandeja
 * con lista virtual (Angular CDK) y el detalle de la alerta elegida. Al abrir una alerta se marca como leída.
 */
@Component({
  selector: 'app-mis-alertas',
  imports: [FormsModule, RouterLink, DatePipe, CdkVirtualScrollViewport, CdkFixedSizeVirtualScroll, CdkVirtualForOf,
    Aviso, Cargando, EstadoVacio, EtiquetaPipe, Icono, TPipe, TApiPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mis-alertas.html',
  styleUrl: './mis-alertas.scss',
  host: { '(document:keydown)': 'teclado($event)' },
})
export class MisAlertas implements OnInit {
  protected readonly servicio = inject(AlertaService);
  private readonly notificaciones = inject(NotificacionService);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly elemento = inject(ElementRef<HTMLElement>);
  private readonly relativo = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  private readonly visor = viewChild(CdkVirtualScrollViewport);

  protected readonly altoFila = ALTO_FILA;
  protected readonly niveles = NIVELES;
  protected readonly porId = (_: number, a: Alerta): number => a.id;

  protected readonly alertas = signal<Alerta[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly filtroPredio = signal<number | null>(null);
  protected readonly filtroNivel = signal<NivelRiesgo | null>(null);
  protected readonly filtroDia = signal<string | null>(null);
  protected readonly filtroEstado = signal<FiltroEstado>('todas');
  protected readonly seleccionId = signal<number | null>(null);
  protected readonly marcandoTodas = signal(false);
  /** Índice de la primera fila visible (para la etiqueta flotante de fecha). */
  protected readonly primeraVisible = signal(0);

  private readonly ordenadas = computed(() =>
    [...(this.alertas() ?? [])].sort((a, b) => b.fechaGeneracion.localeCompare(a.fechaGeneracion)));

  /** Predios que tienen alertas, para el filtro. */
  protected readonly predios = computed(() => {
    const mapa = new Map<number, { id: number; nombre: string; n: number }>();
    for (const a of this.ordenadas()) {
      const p = mapa.get(a.predioId) ?? { id: a.predioId, nombre: a.predio, n: 0 };
      p.n += 1;
      mapa.set(a.predioId, p);
    }
    return [...mapa.values()].sort((a, b) => b.n - a.n);
  });

  protected readonly predioTop = computed(() => (this.predios().length > 1 ? this.predios()[0] : null));

  /** Base del resumen: solo el filtro de predio. */
  private readonly delPredio = computed(() =>
    this.ordenadas().filter((a) => this.filtroPredio() === null || a.predioId === this.filtroPredio()));

  protected readonly resumen = computed(() => {
    const l = this.delPredio();
    const noLeidas = l.filter((a) => !a.leida).length;
    return { total: l.length, noLeidas, pct: l.length ? (noLeidas / l.length) * 100 : 0 };
  });

  protected readonly porNivel = computed(() => NIVELES.map((nivel) => {
    const del = this.delPredio().filter((a) => a.nivel === nivel);
    return { nivel, n: del.length, sinLeer: del.filter((a) => !a.leida).length };
  }));

  /** Actividad real de los últimos 30 días (según la fecha de generación). */
  protected readonly actividad = computed<DiaActividad[]>(() => {
    const conteo = new Map<string, number>();
    for (const a of this.delPredio()) {
      const k = claveDia(new Date(a.fechaGeneracion));
      conteo.set(k, (conteo.get(k) ?? 0) + 1);
    }
    const hoy = new Date();
    hoy.setHours(12, 0, 0, 0);
    const dias = Array.from({ length: DIAS_ACTIVIDAD }, (_, i) => {
      const fecha = new Date(hoy.getTime() - (DIAS_ACTIVIDAD - 1 - i) * DIA);
      const clave = claveDia(fecha);
      return { clave, fecha, n: conteo.get(clave) ?? 0, escala: 0 };
    });
    const max = Math.max(1, ...dias.map((d) => d.n));
    return dias.map((d) => ({ ...d, escala: d.n === 0 ? 0 : Math.max(1, Math.ceil((d.n / max) * 4)) }));
  });

  protected readonly totalActividad = computed(() => this.actividad().reduce((s, d) => s + d.n, 0));

  /** Predio + nivel + día (base de los contadores de estado). */
  private readonly filtradas = computed(() => this.delPredio().filter((a) =>
    (this.filtroNivel() === null || a.nivel === this.filtroNivel())
    && (this.filtroDia() === null || claveDia(new Date(a.fechaGeneracion)) === this.filtroDia())));

  protected readonly conteos = computed(() => {
    const l = this.filtradas();
    const noLeidas = l.filter((a) => !a.leida).length;
    return { todas: l.length, 'no-leidas': noLeidas, leidas: l.length - noLeidas };
  });

  /** Lista final. La alerta abierta se mantiene aunque, al leerse, ya no cumpla el filtro «Sin leer». */
  protected readonly visibles = computed(() => this.filtradas().filter((a) =>
    a.id === this.seleccionId()
    || this.filtroEstado() === 'todas' || (this.filtroEstado() === 'leidas') === a.leida));

  protected readonly filtrosActivos = computed(() => {
    const chips: { clave: 'predio' | 'nivel' | 'dia'; texto: string }[] = [];
    const predio = this.predios().find((p) => p.id === this.filtroPredio());
    if (predio) chips.push({ clave: 'predio', texto: predio.nombre });
    if (this.filtroNivel()) chips.push({ clave: 'nivel', texto: `${t('Riesgo')} ${etiqueta(this.filtroNivel()!).toLowerCase()}` });
    if (this.filtroDia()) {
      const [y, m, d] = this.filtroDia()!.split('-').map(Number);
      chips.push({ clave: 'dia', texto: new Date(y, m - 1, d).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }) });
    }
    return chips;
  });

  /** Etiqueta flotante: tramo de fecha de la primera fila visible. */
  protected readonly tramoVisible = computed(() => {
    const a = this.visibles()[this.primeraVisible()];
    return a ? this.tramo(a.fechaGeneracion) : '';
  });

  protected readonly seleccionada = computed(() =>
    (this.alertas() ?? []).find((a) => a.id === this.seleccionId()) ?? null);

  protected readonly posicion = computed(() => this.visibles().findIndex((a) => a.id === this.seleccionId()));

  ngOnInit(): void {
    this.servicio.listar().subscribe({
      next: (l) => this.alertas.set(l),
      error: (e) => this.error.set(mensajeError(e)),
    });
    this.servicio.refrescarContador();
  }

  // ---------- Filtros ----------
  protected alFiltrar(): void {
    this.visor()?.scrollToIndex(0);
  }

  protected cambiarEstado(estado: FiltroEstado): void {
    this.filtroEstado.set(estado);
    this.alFiltrar();
  }

  protected cambiarPredio(id: number | null): void {
    this.filtroPredio.set(this.filtroPredio() === id ? null : id);
    this.alFiltrar();
  }

  protected alternarNivel(nivel: NivelRiesgo): void {
    this.filtroNivel.set(this.filtroNivel() === nivel ? null : nivel);
    this.alFiltrar();
  }

  protected alternarDia(dia: DiaActividad): void {
    if (!dia.n) return;
    this.filtroDia.set(this.filtroDia() === dia.clave ? null : dia.clave);
    this.alFiltrar();
  }

  protected quitarFiltro(clave: 'predio' | 'nivel' | 'dia'): void {
    ({ predio: this.filtroPredio, nivel: this.filtroNivel, dia: this.filtroDia } as const)[clave].set(null);
    this.alFiltrar();
  }

  protected limpiarFiltros(): void {
    this.filtroPredio.set(null);
    this.filtroNivel.set(null);
    this.filtroDia.set(null);
    this.filtroEstado.set('todas');
    this.alFiltrar();
  }

  // ---------- Selección y navegación ----------
  /** T90: al abrir una alerta sin leer, se marca como leída. */
  protected abrir(alerta: Alerta): void {
    this.seleccionId.set(alerta.id);
    if (!alerta.leida) {
      this.marcarLeida(alerta);
    }
    this.asegurarVisible(this.visibles().findIndex((a) => a.id === alerta.id));
    if (window.matchMedia('(max-width: 900px)').matches) {
      queueMicrotask(() => this.elemento.nativeElement.querySelector('.detalle')?.scrollIntoView({ block: 'start' }));
    }
  }

  protected cerrar(): void {
    this.seleccionId.set(null);
  }

  protected mover(paso: number): void {
    const destino = this.visibles()[this.posicion() + paso];
    if (destino) {
      this.abrir(destino);
    }
  }

  private asegurarVisible(indice: number): void {
    const visor = this.visor();
    if (!visor || indice < 0) return;
    const { start, end } = visor.getRenderedRange();
    const alto = visor.getViewportSize();
    const desplazado = visor.measureScrollOffset('top');
    const arriba = indice * ALTO_FILA;
    if (indice <= start || indice >= end - 1 || arriba < desplazado || arriba + ALTO_FILA > desplazado + alto) {
      visor.scrollToOffset(Math.max(0, arriba - alto / 2 + ALTO_FILA / 2), 'smooth');
    }
  }

  /** ↑/↓ o K/J recorren las alertas; Esc cierra el detalle. */
  protected teclado(ev: KeyboardEvent): void {
    const objetivo = ev.target as HTMLElement;
    if (!this.alertas()?.length || ['INPUT', 'SELECT', 'TEXTAREA'].includes(objetivo.tagName)) {
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'j') {
      ev.preventDefault();
      this.seleccionId() === null && this.visibles()[0] ? this.abrir(this.visibles()[0]) : this.mover(1);
    } else if (ev.key === 'ArrowUp' || ev.key === 'k') {
      ev.preventDefault();
      this.mover(-1);
    } else if (ev.key === 'Escape' && this.seleccionId() !== null) {
      this.cerrar();
    }
  }

  // ---------- Lectura ----------
  protected marcarLeida(alerta: Alerta): void {
    this.servicio.marcarLeida(alerta.id).subscribe({
      next: () => this.marcarLocal([alerta.id]),
      error: (e) => this.notificaciones.error(mensajeError(e)),
    });
  }

  /** Marca como leídas las alertas sin leer de la vista actual (el backend no permite desmarcarlas: se confirma antes). */
  protected async marcarTodas(): Promise<void> {
    const ids = this.filtradas().filter((a) => !a.leida).map((a) => a.id);
    if (!ids.length) return;
    const ok = await this.confirmacion.confirmar({
      titulo: t('¿Marcar todas como leídas?'),
      mensaje: t('Se marcarán {n} alertas como leídas. Esta acción no se puede deshacer.', { n: ids.length }),
      textoConfirmar: t('Marcar como leídas'),
    });
    if (!ok) return;
    this.marcandoTodas.set(true);
    let pendientes = ids.length;
    let fallos = 0;
    for (const id of ids) {
      this.servicio.marcarLeida(id).subscribe({
        next: () => this.marcarLocal([id]),
        error: () => (fallos += 1),
      }).add(() => {
        pendientes -= 1;
        if (!pendientes) {
          this.marcandoTodas.set(false);
          fallos
            ? this.notificaciones.error(t('No se pudieron marcar {n} alertas. Inténtalo nuevamente.', { n: fallos }))
            : this.notificaciones.exito(t('Listo: {n} alertas marcadas como leídas.', { n: ids.length }));
        }
      });
    }
  }

  private marcarLocal(ids: number[]): void {
    const ahora = new Date().toISOString();
    this.alertas.update((l) => (l ?? []).map((a) => (ids.includes(a.id) ? { ...a, leida: true, fechaLectura: ahora } : a)));
  }

  // ---------- Formato ----------
  protected haceCuanto(fecha: string): string {
    const minutos = Math.round((Date.now() - new Date(fecha).getTime()) / 60_000);
    if (minutos < 60) return this.relativo.format(-Math.max(1, minutos), 'minute');
    if (minutos < 1440) return this.relativo.format(-Math.round(minutos / 60), 'hour');
    const dias = Math.round(minutos / 1440);
    if (dias < 30) return this.relativo.format(-dias, 'day');
    if (dias < 365) return this.relativo.format(-Math.round(dias / 30), 'month');
    return this.relativo.format(-Math.round(dias / 365), 'year');
  }

  private tramo(fecha: string): string {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const ms = new Date(fecha).getTime();
    if (ms >= hoy.getTime()) return t('Hoy');
    if (ms >= hoy.getTime() - DIA) return t('Ayer');
    if (ms >= hoy.getTime() - 7 * DIA) return t('Esta semana');
    if (ms >= hoy.getTime() - 30 * DIA) return t('Este mes');
    return t('Anteriores');
  }

  protected tituloDia(d: DiaActividad): string {
    const fecha = d.fecha.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
    return `${fecha}: ${d.n === 1 ? t('1 alerta') : t('{n} alertas', { n: d.n })}`;
  }

  protected acciones(texto: string | null): string[] {
    return (texto ?? '').split(/[;\n·]+/).map((x) => x.trim()).filter(Boolean)
      .map((x) => x.charAt(0).toLocaleUpperCase() + x.slice(1));
  }
}
