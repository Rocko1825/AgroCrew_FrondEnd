import { Component, input, signal } from '@angular/core';

@Component({
  selector: 'app-copiar-texto',
  standalone: true,
  template: `
    <button
      type="button"
      class="btn-copiar"
      [class.copiado]="copiado()"
      (click)="copiar()"
      [attr.aria-label]="copiado() ? 'Copiado' : etiqueta()"
    >
      {{ copiado() ? '✓ Copiado' : etiqueta() }}
    </button>
  `,
  styles: [
    `
      .btn-copiar {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.3rem 0.65rem;
        font-size: 0.85rem;
        border-radius: 6px;
        border: 1px solid #cbd5e1;
        background: #ffffff;
        color: #1e293b;
        cursor: pointer;
        transition:
          background-color 0.2s ease,
          border-color 0.2s ease;
      }

      .btn-copiar:hover {
        background: #f1f5f9;
      }

      .btn-copiar.copiado {
        border-color: #2f5d3a;
        background: #ecfdf5;
        color: #2f5d3a;
        font-weight: 600;
      }
    `,
  ],
})
export class CopiarTexto {
  texto = input.required<string>();
  etiqueta = input<string>('Copiar');
  copiado = signal(false);

  private timerId: ReturnType<typeof setTimeout> | null = null;

  async copiar(): Promise<void> {
    const valor = this.texto();
    if (!valor) return;

    try {
      await navigator.clipboard.writeText(valor);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = valor;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    this.copiado.set(true);
    if (this.timerId) {
      clearTimeout(this.timerId);
    }
    this.timerId = setTimeout(() => this.copiado.set(false), 2000);
  }
}
