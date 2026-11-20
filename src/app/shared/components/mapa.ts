import {
  afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input,
  output, viewChild,
} from '@angular/core';
import * as L from 'leaflet';
// El plugin de calor se registra sobre window.L (Leaflet lo define al cargarse).
import 'leaflet.heat';
import { t } from '../../core/i18n/idioma';
import { NivelRiesgo } from '../../core/models/api.models';

export interface MarcadorMapa {
  latitud: number;
  longitud: number;
  color: string;
  /** Radio del círculo en píxeles. */
  radio?: number;
  /** Texto de la ventana emergente al pulsar el marcador (se muestra como texto, no como HTML). */
  popup?: string;
  /** Texto breve que aparece al pasar el cursor. */
  titulo?: string;
  /** Identificador opcional: permite resaltar el marcador y saber cuál se pulsó. */
  id?: number;
}

export interface VistaMapa {
  latitud: number;
  longitud: number;
  /** Radio aproximado en km del área visible (máximo 50, el límite de la API). */
  radioKm: number;
}

/** Colores de los puntos críticos según su nivel de riesgo. */
export const COLOR_NIVEL: Record<NivelRiesgo, string> = {
  BAJO: '#2F7D4A',
  MEDIO: '#B98900',
  ALTO: '#D9661F',
  MUY_ALTO: '#A1231A',
};

const CENTRO_PERU: L.LatLngTuple = [-9.19, -75.02];
const LIMITES_PERU = L.latLngBounds([-18.4, -81.4], [0.1, -68.6]);

/**
 * Mapa base reutilizable con Leaflet y OpenStreetMap (T92). Sirve para:
 * - marcar la ubicación de un predio (seleccionable = true → emite puntoSeleccionado),
 * - mostrar puntos críticos por nivel de riesgo (marcadores),
 * - la capa de calor del dashboard (calor).
 */
@Component({
  selector: 'app-mapa',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #contenedor class="mapa" [style.height]="alto()" role="region" [attr.aria-label]="etiqueta()"></div>`,
})
export class Mapa {
  readonly centro = input<[number, number] | null>(null);
  readonly zoom = input(5);
  readonly marcadores = input<MarcadorMapa[]>([]);
  /** Punto elegido por el usuario (ubicación del predio). */
  readonly punto = input<[number, number] | null>(null);
  readonly seleccionable = input(false);
  /** Puntos de la capa de calor: [latitud, longitud, intensidad 0..1]. */
  readonly calor = input<[number, number, number][] | null>(null);
  /** Ajusta la vista para que se vean todos los marcadores. */
  readonly ajustar = input(false);
  readonly alto = input<string | null>(null);
  readonly etiqueta = input(t('Mapa'));
  /** Id del marcador a resaltar (más grande y con borde oscuro), sin redibujar el mapa. */
  readonly resaltado = input<number | null>(null);

  readonly puntoSeleccionado = output<{ latitud: number; longitud: number }>();
  /** Se emite al terminar de mover o acercar el mapa. */
  readonly movido = output<VistaMapa>();
  /** Se emite con el id del marcador pulsado (solo marcadores con id). */
  readonly marcadorPulsado = output<number>();

  private readonly contenedor = viewChild.required<ElementRef<HTMLDivElement>>('contenedor');
  private mapa?: L.Map;
  /** El encuadre automático se hace una sola vez, para no pelear con el zoom que elija el usuario. */
  private yaAjustado = false;
  private readonly capaMarcadores = L.layerGroup();
  private readonly circulosPorId = new Map<number, { circulo: L.CircleMarker; radio: number }>();
  private capaPunto?: L.CircleMarker;
  private capaCalor?: L.Layer;

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const mapa = L.map(this.contenedor().nativeElement, {
        center: this.centro() ?? CENTRO_PERU,
        zoom: this.centro() ? this.zoom() : 5,
        maxBounds: LIMITES_PERU.pad(0.3),
        minZoom: 4,
      });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(mapa);
      this.capaMarcadores.addTo(mapa);

      mapa.on('click', (e: L.LeafletMouseEvent) => {
        if (this.seleccionable()) {
          this.puntoSeleccionado.emit({
            latitud: Number(e.latlng.lat.toFixed(6)),
            longitud: Number(e.latlng.lng.toFixed(6)),
          });
        }
      });
      mapa.on('moveend', () => this.movido.emit(this.vista(mapa)));
      this.mapa = mapa;

      // Si el mapa aparece dentro de un contenedor que cambia de tamaño, Leaflet debe recalcularlo.
      const observador = new ResizeObserver(() => mapa.invalidateSize());
      observador.observe(this.contenedor().nativeElement);
      destroyRef.onDestroy(() => {
        observador.disconnect();
        mapa.remove();
      });

      this.dibujarMarcadores();
      this.dibujarPunto();
      this.dibujarCalor();
      this.movido.emit(this.vista(mapa));
    });

    effect(() => {
      this.marcadores();
      this.dibujarMarcadores();
    });
    effect(() => {
      this.punto();
      this.dibujarPunto();
    });
    effect(() => {
      this.resaltado();
      this.aplicarResaltado();
    });
    effect(() => {
      this.calor();
      this.dibujarCalor();
    });
    effect(() => {
      const centro = this.centro();
      if (this.mapa && centro) {
        this.mapa.setView(centro, this.zoom());
      }
    });
  }

  private dibujarMarcadores(): void {
    if (!this.mapa) {
      return;
    }
    this.capaMarcadores.clearLayers();
    this.circulosPorId.clear();
    for (const m of this.marcadores()) {
      const circulo = L.circleMarker([m.latitud, m.longitud], {
        radius: m.radio ?? 8,
        color: '#FFFFFF',
        weight: 2,
        fillColor: m.color,
        fillOpacity: 0.95,
      });
      if (m.popup) {
        circulo.bindPopup(() => this.contenidoPopup(m.popup!), this.opcionesPopup());
      }
      if (m.titulo) {
        circulo.bindTooltip(m.titulo);
      }
      if (m.id !== undefined) {
        const id = m.id;
        this.circulosPorId.set(id, { circulo, radio: m.radio ?? 8 });
        circulo.on('click', () => this.marcadorPulsado.emit(id));
      }
      this.capaMarcadores.addLayer(circulo);
    }
    this.aplicarResaltado();
    const lista = this.marcadores();
    if (this.ajustar() && !this.yaAjustado && lista.length > 0) {
      this.yaAjustado = true;
      const limites = L.latLngBounds(lista.map((m) => [m.latitud, m.longitud] as L.LatLngTuple));
      this.mapa.fitBounds(limites.pad(0.25), { maxZoom: 13 });
    }
  }

  /**
   * Ventana emergente compacta: la primera línea es el título y el resto se muestra como «Etiqueta: valor».
   * Se arma con textContent (nunca como HTML).
   */
  private contenidoPopup(texto: string): HTMLElement {
    const [titulo, ...lineas] = texto.split(/\r?\n/).filter((l) => l.trim());
    const caja = document.createElement('div');
    caja.className = 'popup-mapa';
    const cabeza = document.createElement('strong');
    cabeza.className = 'popup-titulo';
    cabeza.textContent = titulo ?? '';
    caja.appendChild(cabeza);
    if (lineas.length) {
      const lista = document.createElement('dl');
      for (const linea of lineas) {
        const corte = linea.indexOf(':');
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        if (corte > 0) {
          dt.textContent = linea.slice(0, corte).trim();
          dd.textContent = linea.slice(corte + 1).trim();
        } else {
          dd.textContent = linea;
          dd.style.gridColumn = '1 / -1';
        }
        if (dt.textContent) lista.appendChild(dt);
        lista.appendChild(dd);
      }
      caja.appendChild(lista);
    }
    return caja;
  }

  /** Ajusta la ventana al tamaño del mapa para que siempre se vea completa sin arrastrar. */
  private opcionesPopup(): L.PopupOptions {
    const alto = this.mapa?.getSize().y ?? 400;
    const ancho = this.mapa?.getSize().x ?? 400;
    return {
      maxWidth: Math.min(300, ancho - 60),
      minWidth: Math.min(220, ancho - 60),
      maxHeight: Math.max(140, alto - 90),
      autoPan: true,
      autoPanPaddingTopLeft: [20, 20],
      autoPanPaddingBottomRight: [20, 20],
      keepInView: true,
      className: 'popup-agrocrew',
    };
  }

  private aplicarResaltado(): void {
    const elegido = this.resaltado();
    for (const [id, { circulo, radio }] of this.circulosPorId) {
      const activo = id === elegido;
      circulo.setStyle({ radius: activo ? radio + 5 : radio, color: activo ? '#1F2530' : '#FFFFFF', weight: activo ? 3 : 2 });
      if (activo) {
        circulo.bringToFront();
      }
    }
  }

  private dibujarPunto(): void {
    if (!this.mapa) {
      return;
    }
    this.capaPunto?.remove();
    this.capaPunto = undefined;
    const punto = this.punto();
    if (punto) {
      this.capaPunto = L.circleMarker(punto, {
        radius: 10, color: '#FFFFFF', weight: 3, fillColor: '#2F5D3A', fillOpacity: 1,
      }).bindTooltip(t('Ubicación del predio')).addTo(this.mapa);
    }
  }

  private dibujarCalor(): void {
    if (!this.mapa) {
      return;
    }
    this.capaCalor?.remove();
    this.capaCalor = undefined;
    const puntos = this.calor();
    const global = globalThis as unknown as { L?: { heatLayer?: (p: unknown, o: unknown) => L.Layer } };
    if (puntos && puntos.length > 0 && global.L?.heatLayer) {
      this.capaCalor = global.L.heatLayer(puntos, {
        radius: 28,
        blur: 22,
        minOpacity: 0.35,
        maxZoom: 12,
        gradient: { 0.3: '#F2D16B', 0.6: '#E8892F', 0.9: '#A1231A' },
      });
      this.capaCalor.addTo(this.mapa);
    }
  }

  private vista(mapa: L.Map): VistaMapa {
    const centro = mapa.getCenter();
    const radioKm = centro.distanceTo(mapa.getBounds().getNorthEast()) / 1000;
    return {
      latitud: centro.lat,
      longitud: centro.lng,
      radioKm: Math.max(1, Math.min(50, radioKm)),
    };
  }
}
