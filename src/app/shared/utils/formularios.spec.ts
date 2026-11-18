import { FormControl, FormGroup } from '@angular/forms';
import {
  aplicarErroresServidor,
  enRango,
  errorDe,
  LIMITES_PERU,
  minimoNoMayorQueMaximo,
  PATRON_PASSWORD,
  PATRON_TELEFONO,
} from './formularios';

describe('Utilidades de formularios', () => {
  describe('patrones', () => {
    it('la contraseña exige letras, números y entre 8 y 64 caracteres', () => {
      expect(PATRON_PASSWORD.test('clave1234')).toBe(true);
      expect(PATRON_PASSWORD.test('sololetras')).toBe(false);
      expect(PATRON_PASSWORD.test('12345678')).toBe(false);
      expect(PATRON_PASSWORD.test('a1')).toBe(false);
    });

    it('el teléfono debe tener exactamente 9 dígitos', () => {
      expect(PATRON_TELEFONO.test('987654321')).toBe(true);
      expect(PATRON_TELEFONO.test('98765432')).toBe(false);
      expect(PATRON_TELEFONO.test('9876543210')).toBe(false);
      expect(PATRON_TELEFONO.test('98765432a')).toBe(false);
    });
  });

  describe('enRango', () => {
    const validador = enRango(LIMITES_PERU.latMin, LIMITES_PERU.latMax);

    it('acepta una latitud dentro del Perú', () => {
      expect(validador(new FormControl(-12.04))).toBeNull();
    });

    it('rechaza una latitud fuera del Perú', () => {
      expect(validador(new FormControl(40.4))).toEqual({ fueraDelPeru: true });
    });

    it('no valida los campos vacíos (los controla "required")', () => {
      expect(validador(new FormControl(''))).toBeNull();
      expect(validador(new FormControl(null))).toBeNull();
    });
  });

  describe('minimoNoMayorQueMaximo', () => {
    const crear = (min: unknown, max: unknown) =>
      new FormGroup(
        { min: new FormControl(min), max: new FormControl(max) },
        { validators: minimoNoMayorQueMaximo('min', 'max', 'El mínimo no puede superar al máximo.') },
      );

    it('es válido cuando el mínimo es menor o igual al máximo', () => {
      expect(crear(10, 20).errors).toBeNull();
      expect(crear(20, 20).errors).toBeNull();
    });

    it('marca error cuando el mínimo supera al máximo', () => {
      expect(crear(30, 20).errors).toEqual({ rango_min: 'El mínimo no puede superar al máximo.' });
    });

    it('no valida si falta alguno de los dos valores', () => {
      expect(crear('', 20).errors).toBeNull();
      expect(crear(10, null).errors).toBeNull();
    });
  });

  describe('errorDe', () => {
    it('no muestra errores si el usuario aún no tocó el campo', () => {
      const control = new FormControl('');
      control.setErrors({ required: true });
      expect(errorDe(control)).toBeNull();
    });

    it('muestra el mensaje de "required" cuando el campo fue tocado', () => {
      const control = new FormControl('');
      control.setErrors({ required: true });
      control.markAsTouched();
      expect(errorDe(control)).toBe('Este dato es obligatorio.');
    });

    it('usa el mensaje propio del campo para el error de formato', () => {
      const control = new FormControl('abc');
      control.setErrors({ pattern: true });
      control.markAsDirty();
      expect(errorDe(control, 'Escribe 9 dígitos.')).toBe('Escribe 9 dígitos.');
    });

    it('incluye la longitud mínima en el mensaje', () => {
      const control = new FormControl('ab');
      control.setErrors({ minlength: { requiredLength: 8, actualLength: 2 } });
      control.markAsTouched();
      expect(errorDe(control)).toBe('Debe tener al menos 8 caracteres.');
    });

    it('devuelve null si el control no existe', () => {
      expect(errorDe(null)).toBeNull();
    });
  });

  describe('aplicarErroresServidor', () => {
    it('pasa los errores del backend a cada control y lo marca como tocado', () => {
      const formulario = new FormGroup({ correo: new FormControl('a@b.com'), telefono: new FormControl('1') });
      aplicarErroresServidor(formulario, { correo: 'Ese correo ya está registrado.' });

      expect(formulario.get('correo')?.errors).toEqual({ servidor: 'Ese correo ya está registrado.' });
      expect(formulario.get('correo')?.touched).toBe(true);
      expect(formulario.get('telefono')?.errors).toBeNull();
    });

    it('acepta nombres de campo con ruta (por ejemplo "predio.nombre")', () => {
      const formulario = new FormGroup({ nombre: new FormControl('') });
      aplicarErroresServidor(formulario, { 'predio.nombre': 'El nombre es obligatorio.' });
      expect(formulario.get('nombre')?.errors).toEqual({ servidor: 'El nombre es obligatorio.' });
    });

    it('ignora los campos que no existen y no falla sin detalles', () => {
      const formulario = new FormGroup({ nombre: new FormControl('') });
      expect(() => aplicarErroresServidor(formulario, { otro: 'x' })).not.toThrow();
      expect(() => aplicarErroresServidor(formulario)).not.toThrow();
    });
  });
});
