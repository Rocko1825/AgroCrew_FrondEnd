import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LOCALE, t } from '../../../core/i18n/idioma';
import { mensajeError } from '../../../core/interceptors/auth.interceptor';
import { Predio } from '../../../core/models/api.models';
import { AlertaService } from '../../../core/services/alerta.service';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmacionService } from '../../../core/services/confirmacion.service';
import { NotificacionService } from '../../../core/services/notificacion.service';
import { PredioService } from '../../../core/services/predio.service';
import { Ayuda } from '../../../shared/components/ayuda';
import { Aviso } from '../../../shared/components/aviso';
import { Cargando } from '../../../shared/components/cargando';
import { Contador } from '../../../shared/components/contador';
import { EstadoVacio } from '../../../shared/components/estado-vacio';
import { Icono, NombreIcono } from '../../../shared/components/icono';
import { Mapa, MarcadorMapa } from '../../../shared/components/mapa';
import { EtiquetaPipe } from '../../../shared/pipes/etiqueta.pipe';
import { TPipe } from '../../../shared/pipes/t.pipe';

type Filtro = 'todos' | 'pendientes' | 'evaluados';
type Orden = 'nombre' | 'area' | 'recientes';

export interface Zona {
  clave: 'costa' | 'sierra' | 'selva' | 'sin-dato';
  nombre: string;
  icono: NombreIcono;
  color: string;
}

const ZONAS: Record<Zona['clave'], Zona> = {
  costa: { clave: 'costa', nombre: 'Costa', icono: 'ola', color: '#C9A66B' },
  sierra: { clave: 'sierra', nombre: 'Sierra', icono: 'montana', color: '#9C6B3F' },
  selva: { clave: 'selva', nombre: 'Selva', icono: 'hoja', color: '#2F7D4A' },
  'sin-dato': { clave: 'sin-dato', nombre: 'Sin altitud', icono: 'ubicacion', color: '#9AA79E' },
};

/** Línea aproximada de la cordillera (latitud, longitud): al oeste está la costa y al este la selva. */
const CORDILLERA: [number, number][] = [[-3, -80.2], [-6, -79.3], [-9, -77.6], [-12, -76.0], [-15, -73.5], [-18, -70.0]];

function longitudCordillera(lat: number): number {
  if (lat >= CORDILLERA[0][0]) return CORDILLERA[0][1];
  for (let i = 1; i < CORDILLERA.length; i++) {
    const [la1, lo1] = CORDILLERA[i - 1];
    const [la2, lo2] = CORDILLERA[i];
    if (lat >= la2) return lo1 + ((lat - la1) / (la2 - la1)) * (lo2 - lo1);
  }
  return CORDILLERA[CORDILLERA.length - 1][1];
}

/** Zona estimada: desde 1500 msnm es sierra; más abajo, costa u oriente (selva) según el lado de la cordillera. */
export function zonaDe(p: Predio): Zona {
  const alt = p.altitudMsnm;
  if (alt === null || alt === undefined) return ZONAS['sin-dato'];
  if (alt >= 1500) return ZONAS.sierra;
  return p.longitud < longitudCordillera(p.latitud) ? ZONAS.costa : ZONAS.selva;
}

/**
 * Mis predios (US08, T79) con edición (US09) y eliminación con confirmación (US10, T81).
 * Diseño: indicadores con forma (barras) junto al mapa de los predios; tarjetas con el color de su zona
 * (costa, sierra o selva, estimada por altitud) y el estado de evaluación como etiqueta; editar y eliminar en un menú.
 */
@Component({
  selector: 'app-mis-predios',
  imports: [RouterLink, DecimalPipe, Ayuda, Aviso, Cargando, Contador, EstadoVacio, Icono, Mapa, EtiquetaPipe, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mis-predios.html',
  styleUrl: './mis-predios.scss',
  host: { '(document:click)': 'menuAbierto.set(null)', '(document:keydown.escape)': 'menuAbierto.set(null)' },
})
export class MisPredios implements OnInit {
  private readonly predios = inject(PredioService);
  private readonly confirmacion = inject(ConfirmacionService);
  private readonly alertas = inject(AlertaService);
  private readonly notificaciones = inject(NotificacionService);
  protected readonly auth = inject(AuthService);

  protected readonly lista = signal<Predio[] | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly busqueda = signal('');
  protected readonly filtro = signal<Filtro>('todos');
  protected readonly orden = signal<Orden>('nombre');
  /** Predio resaltado a la vez en su tarjeta y en el mapa. */
  protected readonly resaltado = signal<number | null>(null);
  protected readonly menuAbierto = signal<number | null>(null);

  protected readonly zonaDe = zonaDe;

  private readonly todos = computed(() => this.lista() ?? []);
  protected readonly areaTotal = computed(() => this.todos().reduce((s, p) => s + Number(p.areaHa), 0));
  protected readonly evaluados = computed(() => this.todos().filter((p) => p.ultimaEvaluacion).length);
  protected readonly pendientes = computed(() => this.todos().length - this.evaluados());
  protected readonly pctEvaluados = computed(() => (this.todos().length ? (this.evaluados() / this.todos().length) * 100 : 0));
  protected readonly departamentos = computed(() => new Set(this.todos().map((p) => p.departamento)).size);
  protected readonly masGrande = computed(() =>
    this.todos().reduce<Predio | null>((m, p) => (!m || Number(p.areaHa) > Number(m.areaHa) ? p : m), null));

  /** Segmentos de la barra de área: un tramo por predio, del más grande al más pequeño. */
  protected readonly segmentosArea = computed(() => {
    const total = this.areaTotal() || 1;
    return [...this.todos()]
      .sort((a, b) => Number(b.areaHa) - Number(a.areaHa))
      .map((p) => ({ id: p.id, nombre: p.nombre, pct: (Number(p.areaHa) / total) * 100, color: zonaDe(p).color }));
  });

  protected readonly conteos = computed(() => ({
    todos: this.todos().length,
    pendientes: this.pendientes(),
    evaluados: this.evaluados(),
  }));

  protected readonly visibles = computed(() => {
    const q = this.normalizar(this.busqueda().trim());
    const f = this.filtro();
    const lista = this.todos().filter((p) => {
      if (f === 'pendientes' && p.ultimaEvaluacion) return false;
      if (f === 'evaluados' && !p.ultimaEvaluacion) return false;
      return !q || this.normalizar(`${p.nombre} ${p.distrito} ${p.provincia} ${p.departamento}`).includes(q);
    });
    const orden = this.orden();
    return lista.sort((a, b) =>
      orden === 'area' ? Number(b.areaHa) - Number(a.areaHa)
        : orden === 'recientes' ? b.fechaRegistro.localeCompare(a.fechaRegistro)
          : a.nombre.localeCompare(b.nombre, LOCALE));
  });

  protected readonly marcadores = computed<MarcadorMapa[]>(() => this.visibles().map((p) => ({
    id: p.id,
    latitud: p.latitud,
    longitud: p.longitud,
    color: zonaDe(p).color,
    radio: 9,
    titulo: `${p.nombre} · ${p.areaHa} ha`,
  })));

  private readonly relativo = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

  ngOnInit(): void {
    this.predios.listar().subscribe({
      next: (l) => this.lista.set(l),
      error: (e) => this.error.set(mensajeError(e)),
    });
  }

  /** «hace 7 días», «ayer», «hace 2 meses». */
  protected haceCuanto(fecha: string): string {
    const dias = Math.round((Date.now() - new Date(fecha).getTime()) / 86_400_000);
    if (dias < 30) return this.relativo.format(-Math.max(0, dias), 'day');
    if (dias < 365) return this.relativo.format(-Math.round(dias / 30), 'month');
    return this.relativo.format(-Math.round(dias / 365), 'year');
  }

  protected participacion(p: Predio): number {
    return this.areaTotal() ? (Number(p.areaHa) / this.areaTotal()) * 100 : 0;
  }

  protected alternarMenu(id: number, ev: Event): void {
    ev.stopPropagation();
    this.menuAbierto.update((m) => (m === id ? null : id));
  }

  /** Al pulsar un pin del mapa: resalta su tarjeta y la trae a la vista. */
  protected enfocarTarjeta(id: number): void {
    this.resaltado.set(id);
    if (!this.visibles().some((p) => p.id === id)) {
      this.filtro.set('todos');
      this.busqueda.set('');
    }
    queueMicrotask(() => document.getElementById(`predio-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  protected verPendientes(): void {
    this.filtro.set(this.filtro() === 'pendientes' ? 'todos' : 'pendientes');
  }

  protected async eliminar(predio: Predio): Promise<void> {
    this.menuAbierto.set(null);
    const aceptado = await this.confirmacion.confirmar({
      titulo: t('¿Eliminar «{nombre}»?', { nombre: predio.nombre }),
      mensaje: t('El predio dejará de aparecer en tu lista y ya no recibirás alertas de él. Sus evaluaciones anteriores se conservan.'),
      textoConfirmar: t('Sí, eliminar'),
      peligro: true,
    });
    if (!aceptado) {
      return; // US10: si se cancela, el predio no cambia.
    }
    this.predios.eliminar(predio.id).subscribe({
      next: () => {
        this.lista.update((l) => (l ?? []).filter((p) => p.id !== predio.id));
        this.alertas.refrescarContador(); // sus alertas dejan de contarse
        this.notificaciones.exito(t('Eliminaste el predio «{nombre}».', { nombre: predio.nombre }));
      },
      error: (e) => this.notificaciones.error(mensajeError(e)),
    });
  }

  private normalizar(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
}
