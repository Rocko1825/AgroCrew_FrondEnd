import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'formatoNumero',
  standalone: true,
})
export class FormatoNumeroPipe implements PipeTransform {
  transform(valor: number | null | undefined, decimales = 0): string {
    if (valor === null || valor === undefined || Number.isNaN(valor)) {
      return '—';
    }

    const langHtml = typeof document !== 'undefined' ? document.documentElement.lang : '';
    const langNav = typeof navigator !== 'undefined' ? navigator.language : '';
    const idiomaActivo = (langHtml || langNav || 'es-PE').toLowerCase();
    const locale = idiomaActivo.startsWith('en') ? 'en-US' : 'es-PE';

    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(valor);
  }
}
